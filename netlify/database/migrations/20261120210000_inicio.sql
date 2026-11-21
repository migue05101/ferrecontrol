CREATE TABLE ferreterias (
  slug TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  creado TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE usuarios (
  id SERIAL PRIMARY KEY,
  ferreteria TEXT NOT NULL REFERENCES ferreterias(slug) ON DELETE CASCADE,
  usuario TEXT NOT NULL,
  nombre TEXT NOT NULL,
  rol TEXT NOT NULL,
  sal TEXT NOT NULL,
  hash TEXT NOT NULL,
  fallos INTEGER NOT NULL DEFAULT 0,
  bloqueado_hasta TIMESTAMPTZ,
  creado TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ferreteria, usuario)
);

CREATE TABLE estados (
  ferreteria TEXT PRIMARY KEY REFERENCES ferreterias(slug) ON DELETE CASCADE,
  ver INTEGER NOT NULL DEFAULT 1,
  datos JSONB NOT NULL,
  actualizado TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE invitaciones (
  codigo TEXT PRIMARY KEY,
  creado TIMESTAMPTZ NOT NULL DEFAULT now(),
  usado_por TEXT,
  usado TIMESTAMPTZ
);
