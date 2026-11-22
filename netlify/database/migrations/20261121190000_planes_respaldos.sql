ALTER TABLE ferreterias ADD COLUMN plan TEXT NOT NULL DEFAULT 'estandar';
ALTER TABLE ferreterias ADD COLUMN vence TIMESTAMPTZ;
ALTER TABLE ferreterias ADD COLUMN suspendida BOOLEAN NOT NULL DEFAULT false;

UPDATE ferreterias SET vence = now() + interval '30 days' WHERE vence IS NULL;

CREATE TABLE respaldos (
  id SERIAL PRIMARY KEY,
  ferreteria TEXT NOT NULL REFERENCES ferreterias(slug) ON DELETE CASCADE,
  creado TIMESTAMPTZ NOT NULL DEFAULT now(),
  ver INTEGER NOT NULL,
  datos JSONB NOT NULL
);

CREATE INDEX respaldos_ferreteria_creado ON respaldos (ferreteria, creado DESC);
