CREATE TABLE users (
  id SERIAL,
  username TEXT
);
CREATE UNIQUE INDEX ON users(id);

-- CREATE TABLE users (
--   id SMALLSERIAL PRIMARY KEY,
--   username TEXT
-- );