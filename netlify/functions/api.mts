// API de FerreControl: registro, ingreso y datos separados por ferretería.
import { getDatabase } from "@netlify/database";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

declare const Netlify: any;

const env = (k: string): string | undefined => {
  try {
    const v = (globalThis as any).Netlify?.env?.get?.(k);
    if (v) return v;
  } catch {}
  return process.env[k];
};

let _db: any = null;
const db = () => {
  if (!_db) {
    const cs = env("FERRE_TEST_DB");
    _db = cs ? getDatabase({ connectionString: cs }) : getDatabase();
  }
  return _db;
};
const q = async (text: string, params: any[] = []) => (await db().pool.query(text, params)).rows;

const ROLES = ["admin", "vendedor", "bodega", "cajero"];
// Límites de cada plan. null = sin límite.
const PLANES: any = {
  basico: { nombre: "Básico", usuarios: 2, productos: 300 },
  estandar: { nombre: "Estándar", usuarios: 5, productos: 2000 },
  pro: { nombre: "Pro", usuarios: null, productos: null },
};
const DIAS_PRUEBA = 30;
const planDe = (f: any) => {
  const p = PLANES[f.plan] || PLANES.estandar;
  const ms = f.vence ? new Date(f.vence).getTime() - Date.now() : null;
  return {
    plan: PLANES[f.plan] ? f.plan : "estandar", nombre: p.nombre, usuarios: p.usuarios, productos: p.productos,
    vence: f.vence, dias: ms == null ? null : Math.ceil(ms / 864e5),
    estado: f.suspendida ? "suspendida" : ms != null && ms < 0 ? "vencida" : "activa",
  };
};
const DIA = 864e5;

const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
const err = (status: number, error: string, extra: any = {}) => json({ error, ...extra }, status);

const limpio = (s: any, max = 80) => String(s ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const slugDe = (s: any) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
const usuarioDe = (s: any) => slugDe(s).replace(/-/g, "").slice(0, 30);

const hashClave = (clave: string, sal: string) => scryptSync(clave, sal, 32).toString("hex");
const igual = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const b64 = (s: string) => Buffer.from(s).toString("base64url");

function firmar(payload: any) {
  const secreto = env("TOKEN_SECRET");
  if (!secreto) throw new Error("sin_secreto");
  const cuerpo = b64(JSON.stringify(payload));
  return cuerpo + "." + createHmac("sha256", secreto).update(cuerpo).digest("base64url");
}
function leerToken(req: Request) {
  const secreto = env("TOKEN_SECRET");
  const h = req.headers.get("authorization") || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : "";
  const [cuerpo, firma] = tok.split(".");
  if (!secreto || !cuerpo || !firma) return null;
  const buena = createHmac("sha256", secreto).update(cuerpo).digest("base64url");
  if (!igual(firma, buena)) return null;
  try {
    const p = JSON.parse(Buffer.from(cuerpo, "base64url").toString());
    if (!p || p.exp < Date.now()) return null;
    return p as { f: string; u: number; exp: number };
  } catch {
    return null;
  }
}
// La sesión se valida contra la base en cada llamada: si borran al usuario o le cambian el rol, aplica de inmediato.
async function sesion(req: Request) {
  const p = leerToken(req);
  if (!p) return null;
  const r = await q(
    "SELECT u.id,u.usuario,u.nombre,u.rol,u.ferreteria,f.nombre AS fnombre,f.plan,f.vence,f.suspendida FROM usuarios u JOIN ferreterias f ON f.slug=u.ferreteria WHERE u.id=$1 AND u.ferreteria=$2",
    [p.u, p.f],
  );
  return r[0] || null;
}
const pubUsuario = (u: any) => ({ id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol });
const respSesion = (u: any) => ({
  token: firmar({ f: u.ferreteria, u: u.id, exp: Date.now() + 30 * DIA }),
  ferreteria: { slug: u.ferreteria, nombre: u.fnombre },
  usuario: pubUsuario(u),
  plan: planDe(u),
});
const usuariosDe = async (f: string) => (await q("SELECT id,usuario,nombre,rol FROM usuarios WHERE ferreteria=$1 ORDER BY id", [f])).map(pubUsuario);
const estadoVacio = (nombre: string) => ({
  prods: [], provs: [], clientes: [], cxp: [], ventas: [], cots: [], pedidos: [],
  seq: { fv: 1, ct: 1, pd: 1 },
  emp: { nombre, nit: "", dir: "", tel: "", pie: "", logo: null, lw: 0, lh: 0 },
});
const validarClave = (c: any) => typeof c === "string" && c.length >= 6 && c.length <= 100;

async function cuerpo(req: Request) {
  try {
    const t = await req.text();
    if (t.length > 5_000_000) return { _grande: true };
    return t ? JSON.parse(t) : {};
  } catch {
    return {};
  }
}

export default async (req: Request) => {
  const ruta = new URL(req.url).pathname.replace(/^\/api\/?/, "").replace(/\/+$/, "");
  const m = req.method;
  try {
    if (ruta === "ping") return json({ ok: true });
    if (!env("TOKEN_SECRET")) return err(500, "El servidor aún no está configurado.");

    // ---------- proveedor del servicio (clave maestra) ----------
    if (ruta === "maestro" && m === "POST") {
      const b = await cuerpo(req), clave = env("ADMIN_KEY");
      if (!clave || typeof b.clave !== "string" || !igual(hashClave(b.clave, "m"), hashClave(clave, "m"))) {
        await new Promise((r) => setTimeout(r, 600));
        return err(401, "Clave maestra incorrecta.");
      }
      if (b.accion === "codigo") {
        const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        const r = randomBytes(8);
        const cod = "FC-" + [...r].map((x, i) => A[x % A.length] + (i === 3 ? "-" : "")).join("");
        await q("INSERT INTO invitaciones (codigo) VALUES ($1)", [cod]);
      }
      const slug = slugDe(b.slug);
      if (b.accion === "plan" && PLANES[b.plan]) await q("UPDATE ferreterias SET plan=$1 WHERE slug=$2", [b.plan, slug]);
      if (b.accion === "dias") {
        const d = Math.max(1, Math.min(3650, Math.round(Number(b.dias) || 0)));
        await q("UPDATE ferreterias SET vence=GREATEST(COALESCE(vence,now()),now()) + make_interval(days => $1) WHERE slug=$2", [d, slug]);
      }
      if (b.accion === "suspender") await q("UPDATE ferreterias SET suspendida=$1 WHERE slug=$2", [!!b.valor, slug]);
      if (b.accion === "respaldos") {
        const respaldos = await q("SELECT id,creado,ver,jsonb_array_length(COALESCE(datos->'prods','[]'::jsonb)) AS productos,jsonb_array_length(COALESCE(datos->'ventas','[]'::jsonb)) AS ventas FROM respaldos WHERE ferreteria=$1 ORDER BY creado DESC", [slug]);
        return json({ respaldos });
      }
      if (b.accion === "restaurar") {
        const r = (await q("SELECT id FROM respaldos WHERE id=$1 AND ferreteria=$2", [Number(b.id), slug]))[0];
        if (!r) return err(404, "Esa copia no existe.");
        // Antes de restaurar se guarda una copia del estado actual, para poder deshacer.
        await q("INSERT INTO respaldos (ferreteria,ver,datos) SELECT ferreteria,ver,datos FROM estados WHERE ferreteria=$1", [slug]);
        await q("UPDATE estados SET datos=(SELECT datos FROM respaldos WHERE id=$1), ver=ver+1, actualizado=now() WHERE ferreteria=$2", [r.id, slug]);
      }
      const ferreterias = (await q(
        "SELECT f.slug,f.nombre,f.creado,f.plan,f.vence,f.suspendida,e.actualizado,(SELECT count(*)::int FROM usuarios u WHERE u.ferreteria=f.slug) AS usuarios,jsonb_array_length(COALESCE(e.datos->'prods','[]'::jsonb)) AS productos,jsonb_array_length(COALESCE(e.datos->'ventas','[]'::jsonb)) AS ventas FROM ferreterias f LEFT JOIN estados e ON e.ferreteria=f.slug ORDER BY f.creado DESC",
      )).map((f: any) => ({ ...f, info: planDe(f) }));
      const invitaciones = await q("SELECT codigo,creado,usado_por,usado FROM invitaciones ORDER BY creado DESC LIMIT 200");
      return json({ ferreterias, invitaciones, planes: PLANES });
    }

    // ---------- registro de una ferretería con código de invitación ----------
    if (ruta === "registro" && m === "POST") {
      const b = await cuerpo(req);
      const codigo = limpio(b.codigo, 20).toUpperCase(), nombreF = limpio(b.ferreteria), slug = slugDe(nombreF);
      const usuario = usuarioDe(b.usuario), nombre = limpio(b.nombre, 60) || usuario;
      if (!codigo || slug.length < 3) return err(400, "Escribe el código y el nombre de la ferretería.");
      if (usuario.length < 3) return err(400, "El usuario debe tener al menos 3 letras o números.");
      if (!validarClave(b.clave)) return err(400, "La contraseña debe tener al menos 6 caracteres.");
      const c = await db().pool.connect();
      try {
        await c.query("BEGIN");
        const inv = (await c.query("SELECT codigo,usado_por FROM invitaciones WHERE codigo=$1 FOR UPDATE", [codigo])).rows[0];
        if (!inv || inv.usado_por) {
          await c.query("ROLLBACK");
          return err(400, "El código de invitación no existe o ya fue usado.");
        }
        if ((await c.query("SELECT 1 FROM ferreterias WHERE slug=$1", [slug])).rows[0]) {
          await c.query("ROLLBACK");
          return err(409, "Ya hay una ferretería inscrita con ese nombre. Agrégale la ciudad o el barrio.");
        }
        const sal = randomBytes(16).toString("hex");
        const fr = (await c.query("INSERT INTO ferreterias (slug,nombre,plan,vence) VALUES ($1,$2,'estandar',now() + make_interval(days => $3)) RETURNING plan,vence,suspendida", [slug, nombreF, DIAS_PRUEBA])).rows[0];
        const u = (await c.query(
          "INSERT INTO usuarios (ferreteria,usuario,nombre,rol,sal,hash) VALUES ($1,$2,$3,'admin',$4,$5) RETURNING id,usuario,nombre,rol,ferreteria",
          [slug, usuario, nombre, sal, hashClave(b.clave, sal)],
        )).rows[0];
        await c.query("INSERT INTO estados (ferreteria,datos) VALUES ($1,$2::jsonb)", [slug, JSON.stringify(estadoVacio(nombreF))]);
        await c.query("UPDATE invitaciones SET usado_por=$1, usado=now() WHERE codigo=$2", [slug, codigo]);
        await c.query("COMMIT");
        return json(respSesion({ ...u, ...fr, fnombre: nombreF }), 201);
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    }

    // ---------- ingreso: ferretería + usuario + contraseña ----------
    if (ruta === "login" && m === "POST") {
      const b = await cuerpo(req), slug = slugDe(b.ferreteria), usuario = usuarioDe(b.usuario);
      const mal = async () => {
        await new Promise((r) => setTimeout(r, 500));
        return err(401, "Los datos no coinciden. Revisa la ferretería, el usuario y la contraseña.");
      };
      if (!slug || !usuario || typeof b.clave !== "string") return mal();
      const u = (await q(
        "SELECT u.*,f.nombre AS fnombre,f.plan,f.vence,f.suspendida FROM usuarios u JOIN ferreterias f ON f.slug=u.ferreteria WHERE u.ferreteria=$1 AND u.usuario=$2",
        [slug, usuario],
      ))[0];
      if (!u) return mal();
      if (u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date())
        return err(429, "Demasiados intentos. Espera 10 minutos e inténtalo de nuevo.");
      if (!igual(hashClave(b.clave, u.sal), u.hash)) {
        await q(
          "UPDATE usuarios SET fallos=fallos+1, bloqueado_hasta=CASE WHEN fallos+1>=8 THEN now()+interval '10 minutes' ELSE NULL END WHERE id=$1",
          [u.id],
        );
        return mal();
      }
      await q("UPDATE usuarios SET fallos=0, bloqueado_hasta=NULL WHERE id=$1", [u.id]);
      if (u.suspendida) return err(403, "Esta cuenta está suspendida. Comunícate con FerreControl.");
      return json(respSesion(u));
    }

    // ---------- de aquí en adelante hay que estar dentro de una ferretería ----------
    const yo = await sesion(req);
    if (!yo) return err(401, "Sesión vencida. Vuelve a ingresar.", { sesion: false });
    const F = yo.ferreteria, P = planDe(yo);
    if (P.estado === "suspendida") return err(403, "Esta cuenta está suspendida. Comunícate con FerreControl.", { plan: P });

    if (ruta === "estado" && m === "GET") {
      const e = (await q("SELECT ver,datos FROM estados WHERE ferreteria=$1", [F]))[0];
      if (!e) return err(404, "No se encontraron los datos de la ferretería.");
      return json({ ver: e.ver, estado: e.datos, usuarios: await usuariosDe(F), usuario: pubUsuario(yo), ferreteria: { slug: F, nombre: yo.fnombre }, plan: P });
    }
    if (ruta === "estado" && m === "PUT") {
      const b = await cuerpo(req);
      if (b._grande) return err(413, "Los datos son demasiado grandes para guardarlos de una vez.");
      const s = b.estado;
      if (!s || typeof s !== "object" || !Array.isArray(s.prods) || !Array.isArray(s.ventas)) return err(400, "Datos incompletos.");
      delete s.users; delete s.user; delete s.lista;
      if (P.estado !== "activa") return err(402, "La membresía está vencida.", { plan: P });
      if (P.productos != null && s.prods.length > P.productos) {
        const n = (await q("SELECT jsonb_array_length(COALESCE(datos->'prods','[]'::jsonb)) AS n FROM estados WHERE ferreteria=$1", [F]))[0]?.n ?? 0;
        if (s.prods.length > n) return err(403, `El plan ${P.nombre} permite hasta ${P.productos} productos.`, { limite: "productos", plan: P });
      }
      // Copia diaria automática del estado anterior; se conservan las últimas 30.
      const ult = (await q("SELECT creado FROM respaldos WHERE ferreteria=$1 ORDER BY creado DESC LIMIT 1", [F]))[0];
      if (!ult || Date.now() - new Date(ult.creado).getTime() > DIA) {
        await q("INSERT INTO respaldos (ferreteria,ver,datos) SELECT ferreteria,ver,datos FROM estados WHERE ferreteria=$1", [F]);
        await q("DELETE FROM respaldos WHERE ferreteria=$1 AND id NOT IN (SELECT id FROM respaldos WHERE ferreteria=$1 ORDER BY creado DESC LIMIT 30)", [F]);
      }
      // Solo el administrador cambia los datos de la ferretería (nombre, logo, NIT).
      const sql = yo.rol === "admin"
        ? "UPDATE estados SET datos=$1::jsonb, ver=ver+1, actualizado=now() WHERE ferreteria=$2 AND ver=$3 RETURNING ver"
        : "UPDATE estados SET datos=jsonb_set($1::jsonb,'{emp}',COALESCE(datos->'emp','{}'::jsonb)), ver=ver+1, actualizado=now() WHERE ferreteria=$2 AND ver=$3 RETURNING ver";
      const r = await q(sql, [JSON.stringify(s), F, Number(b.ver) || 0]);
      if (r[0]) return json({ ver: r[0].ver });
      const e = (await q("SELECT ver,datos FROM estados WHERE ferreteria=$1", [F]))[0];
      return json({ error: "conflicto", ver: e.ver, estado: e.datos, usuarios: await usuariosDe(F) }, 409);
    }

    if (ruta === "clave" && m === "POST") {
      const b = await cuerpo(req);
      const u = (await q("SELECT sal,hash FROM usuarios WHERE id=$1", [yo.id]))[0];
      if (typeof b.actual !== "string" || !igual(hashClave(b.actual, u.sal), u.hash)) return err(400, "La contraseña actual no es correcta.");
      if (!validarClave(b.nueva)) return err(400, "La contraseña nueva debe tener al menos 6 caracteres.");
      const sal = randomBytes(16).toString("hex");
      await q("UPDATE usuarios SET sal=$1, hash=$2 WHERE id=$3", [sal, hashClave(b.nueva, sal), yo.id]);
      return json({ ok: true });
    }

    if (ruta === "usuarios" && m === "POST") {
      if (yo.rol !== "admin") return err(403, "Solo el administrador maneja los usuarios.");
      const b = await cuerpo(req);
      if (b.accion === "borrar") {
        const id = Number(b.id);
        if (id === yo.id) return err(400, "No puedes borrar tu propio usuario.");
        await q("DELETE FROM usuarios WHERE id=$1 AND ferreteria=$2", [id, F]);
        return json({ usuarios: await usuariosDe(F) });
      }
      const usuario = usuarioDe(b.usuario), nombre = limpio(b.nombre, 60) || usuario, rol = String(b.rol);
      if (usuario.length < 3) return err(400, "El usuario debe tener al menos 3 letras o números.");
      if (!ROLES.includes(rol)) return err(400, "Perfil no válido.");
      if (b.id) {
        const id = Number(b.id);
        const act = (await q("SELECT id,rol FROM usuarios WHERE id=$1 AND ferreteria=$2", [id, F]))[0];
        if (!act) return err(404, "Ese usuario no existe.");
        if (act.rol === "admin" && rol !== "admin") {
          const n = (await q("SELECT count(*)::int AS n FROM usuarios WHERE ferreteria=$1 AND rol='admin'", [F]))[0].n;
          if (n <= 1) return err(400, "Debe quedar al menos un administrador.");
        }
        if ((await q("SELECT 1 FROM usuarios WHERE ferreteria=$1 AND usuario=$2 AND id<>$3", [F, usuario, id]))[0]) return err(409, "Ya existe ese usuario.");
        await q("UPDATE usuarios SET usuario=$1, nombre=$2, rol=$3 WHERE id=$4 AND ferreteria=$5", [usuario, nombre, rol, id, F]);
        if (b.clave) {
          if (!validarClave(b.clave)) return err(400, "La contraseña debe tener al menos 6 caracteres.");
          const sal = randomBytes(16).toString("hex");
          await q("UPDATE usuarios SET sal=$1, hash=$2, fallos=0, bloqueado_hasta=NULL WHERE id=$3 AND ferreteria=$4", [sal, hashClave(b.clave, sal), id, F]);
        }
      } else {
        if (!validarClave(b.clave)) return err(400, "La contraseña debe tener al menos 6 caracteres.");
        if (P.usuarios != null) {
          const n = (await q("SELECT count(*)::int AS n FROM usuarios WHERE ferreteria=$1", [F]))[0].n;
          if (n >= P.usuarios) return err(403, `El plan ${P.nombre} permite hasta ${P.usuarios} usuarios. Para agregar más, pide un plan superior.`);
        }
        if ((await q("SELECT 1 FROM usuarios WHERE ferreteria=$1 AND usuario=$2", [F, usuario]))[0]) return err(409, "Ya existe ese usuario.");
        const sal = randomBytes(16).toString("hex");
        await q("INSERT INTO usuarios (ferreteria,usuario,nombre,rol,sal,hash) VALUES ($1,$2,$3,$4,$5,$6)", [F, usuario, nombre, rol, sal, hashClave(b.clave, sal)]);
      }
      return json({ usuarios: await usuariosDe(F) });
    }

    return err(404, "Ruta no encontrada.");
  } catch (e: any) {
    console.error("api", ruta, e);
    return err(500, e?.message === "sin_secreto" ? "El servidor aún no está configurado." : "Error del servidor. Inténtalo de nuevo.");
  }
};

export const config = { path: "/api/*" };
