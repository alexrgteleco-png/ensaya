-- Ensaya: esquema propio para poder compartir la base de datos con Keycloak y otras apps.
-- Se ejecuta en cada arranque; todo es idempotente.

CREATE SCHEMA IF NOT EXISTS ensaya;
SET search_path TO ensaya;

CREATE TABLE IF NOT EXISTS users (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sub         text NOT NULL UNIQUE,
  email       text NOT NULL DEFAULT '',
  name        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_login  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_email_idx ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  sid      text PRIMARY KEY,
  data     jsonb NOT NULL DEFAULT '{}',
  expires  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires);

CREATE TABLE IF NOT EXISTS groups (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  genre        text NOT NULL DEFAULT '',
  owner_id     bigint NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  group_id    bigint NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_label  text NOT NULL DEFAULT '',
  joined_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships (user_id);

CREATE TABLE IF NOT EXISTS invitations (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id      bigint NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  email         text NOT NULL,
  role_label    text NOT NULL DEFAULT '',
  token         text NOT NULL UNIQUE,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'declined')),
  invited_by    bigint NOT NULL REFERENCES users(id),
  accepted_by   bigint REFERENCES users(id),
  email_status  text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  responded_at  timestamptz
);
CREATE INDEX IF NOT EXISTS invitations_email_idx ON invitations (lower(email)) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS invitations_group_idx ON invitations (group_id);

CREATE TABLE IF NOT EXISTS songs (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id        bigint NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  title           text NOT NULL,
  artist          text NOT NULL DEFAULT '',
  song_key        text NOT NULL DEFAULT '',
  bpm             integer,
  time_signature  text NOT NULL DEFAULT '',
  duration_sec    integer,
  status          text NOT NULL DEFAULT 'aprendiendo' CHECK (status IN ('idea', 'aprendiendo', 'lista', 'retirada')),
  tags            text NOT NULL DEFAULT '',
  lyrics          text NOT NULL DEFAULT '',
  notes           text NOT NULL DEFAULT '',
  created_by      bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS songs_group_idx ON songs (group_id);

CREATE TABLE IF NOT EXISTS files (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id     bigint NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  song_id      bigint REFERENCES songs(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('audio', 'pdf', 'musicxml', 'image', 'other')),
  label        text NOT NULL DEFAULT '',
  filename     text NOT NULL,
  mime         text NOT NULL DEFAULT 'application/octet-stream',
  size         bigint NOT NULL DEFAULT 0,
  storage_key  text NOT NULL,
  uploaded_by  bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS files_song_idx ON files (song_id);
CREATE INDEX IF NOT EXISTS files_group_idx ON files (group_id);

CREATE TABLE IF NOT EXISTS markers (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  file_id      bigint NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  position_ms  integer NOT NULL,
  label        text NOT NULL,
  created_by   bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS markers_file_idx ON markers (file_id);

-- Anotaciones sobre partituras PDF: una capa del grupo (owner_id = 0) y una personal por usuario.
CREATE TABLE IF NOT EXISTS annotations (
  file_id     bigint NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  page        integer NOT NULL,
  scope       text NOT NULL CHECK (scope IN ('personal', 'group')),
  owner_id    bigint NOT NULL DEFAULT 0,
  strokes     jsonb NOT NULL DEFAULT '[]',
  updated_by  bigint REFERENCES users(id) ON DELETE SET NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (file_id, page, scope, owner_id)
);

-- Partituras creadas con el editor (notación ABC).
CREATE TABLE IF NOT EXISTS scores (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id    bigint NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  song_id     bigint REFERENCES songs(id) ON DELETE CASCADE,
  title       text NOT NULL,
  abc         text NOT NULL DEFAULT '',
  created_by  bigint REFERENCES users(id) ON DELETE SET NULL,
  updated_by  bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scores_song_idx ON scores (song_id);

CREATE TABLE IF NOT EXISTS setlists (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id    bigint NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name        text NOT NULL,
  notes       text NOT NULL DEFAULT '',
  created_by  bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS setlists_group_idx ON setlists (group_id);

CREATE TABLE IF NOT EXISTS setlist_items (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  setlist_id  bigint NOT NULL REFERENCES setlists(id) ON DELETE CASCADE,
  position    integer NOT NULL,
  song_id     bigint REFERENCES songs(id) ON DELETE CASCADE,
  title       text NOT NULL DEFAULT '',
  note        text NOT NULL DEFAULT '',
  transpose   integer NOT NULL DEFAULT 0,
  break_min   integer
);
CREATE INDEX IF NOT EXISTS setlist_items_setlist_idx ON setlist_items (setlist_id, position);

CREATE TABLE IF NOT EXISTS events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id    bigint NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN ('ensayo', 'concierto', 'otro')),
  title       text NOT NULL,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz,
  location    text NOT NULL DEFAULT '',
  details     text NOT NULL DEFAULT '',
  plan        text NOT NULL DEFAULT '',
  post_notes  text NOT NULL DEFAULT '',
  setlist_id  bigint REFERENCES setlists(id) ON DELETE SET NULL,
  created_by  bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_group_idx ON events (group_id, starts_at);

CREATE TABLE IF NOT EXISTS attendance (
  event_id    bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      text NOT NULL CHECK (status IN ('si', 'no', 'quizas')),
  comment     text NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);

-- Canciones trabajadas en un ensayo (plan del ensayo).
CREATE TABLE IF NOT EXISTS event_songs (
  event_id  bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  song_id   bigint NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  position  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, song_id)
);

-- ---------- Control de costes ----------
-- Una subida reserva su tamaño antes de empezar (status 'pending') y pasa a 'ready' al confirmarse.
ALTER TABLE files ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ready';
CREATE INDEX IF NOT EXISTS files_pending_idx ON files (created_at) WHERE status = 'pending';

-- Objetos que hay que borrar del almacenamiento (se reintenta hasta lograrlo; cuentan como ocupados).
CREATE TABLE IF NOT EXISTS pending_deletions (
  storage_key  text PRIMARY KEY,
  size         bigint NOT NULL DEFAULT 0,
  attempts     integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Contadores mensuales: operaciones de R2 y tráfico de salida de Render.
CREATE TABLE IF NOT EXISTS usage_counters (
  month   text NOT NULL,
  metric  text NOT NULL,
  value   bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (month, metric)
);
