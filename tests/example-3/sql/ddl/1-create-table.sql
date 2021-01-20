 CREATE TABLE users (
  id SMALLSERIAL PRIMARY KEY,
  username TEXT
);

CREATE TABLE users_login_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users,
  date DATE DEFAULT NOW() NOT NULL
);