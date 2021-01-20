CREATE VIEW view_users AS 
  SELECT u.username, ulh.* 
  FROM users u 
  LEFT JOIN users_login_history ulh ON u.id = ulh.user_id;