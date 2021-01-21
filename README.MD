# PARSERS.DEV SQL QUERY RESULT TYPE TRACKER
This tool helps you to **automatically trace SQL-queries result type changes** after **[DML](https://en.wikipedia.org/wiki/Data_manipulation_language)** or **[DDL](https://en.wikipedia.org/wiki/Data_definition_language)** refactoring.
Now you can see **result type changes** between the current code state (including uncommitted changes) and last pushed changes in the same or parent branch (if you have no pushed code in the current branch yet).

* **[What can be traced](#what-can-be-traced)**
* **[Examples](#examples)**
* **[How it works](#how-it-works)**
* **[How to install](#how-to-install)**
* **[Params](#params)**
* **[Supported databases](#supported-databases)**
* **[Notice](#notice)**
* **[What's next?](#whats-next)**
* **[Todo](#todo)**

# WHAT CAN BE TRACED
You can trace 3 kinds of changes in your DML query:
 * **field types** with modifications - e.g. VARCHAR(256)
 * **field nullability** - **NULL**, **NOT NULL**, unknown
 * **rows count class** - how many rows can be returned - **NONE, ONE, ONE_OR_NONE, MANY, MANY_OR_NONE**

**[Parsers.dev](https://parsers.dev)** powered by **[holistic.dev](https://holistic.dev)** - SQL static analyzer tool. Because of this, you can get a lot of insights about your database structure and queries. All specific features of the selected database are taken into account - **types, constraints, view, functions, common table expressions**, and others.

**All magic based on DDL and DML source code only, without direct DB connection!**

### Disclaimer:
**Don't use this service as the only source of truth. Check all results when in doubt. We would be grateful if you would point out problems to us in personal messages.**

**Because this tool is based on SaaS, updates can be applied at any time, without prior notice. We will do our best to maintain backward compatibility for as long as possible.**

# EXAMPLES
## Example #1
Let you have pushed DB schema (DDL) like this:
```sql
CREATE TABLE users (
  id SERIAL,
  username TEXT
);
```
and pushed SQL-query (DML) like this:
```sql
SELECT * FROM users u WHERE id = $1;
```

After this you want to make the user's id **UNIQUE**. Your local DDL now looks like this:
```sql
CREATE TABLE users (
  id SERIAL,
  username TEXT
);

CREATE UNIQUE INDEX ON users(id);
```

Ok, let look at how it can affect query result types:
![console output for example #1](./images/example-1.gif?raw=true)

What happened?
When you add a **UNIQUE** constraint, DML query executes with filtering by a **UNIQUE** field. It means now you can get only one row if \$1 value present in the table "users"  or none if not.
The previous version could return multiple rows, because of value \$1 could be inserted in the table multiple times.

## Example #2
OK, next step. Let's commit, push it, and next changes of the previous example DDL like this:

```sql
CREATE TABLE users (
  id SMALLSERIAL PRIMARY KEY,
  username TEXT
);
```
and DML like this:
```sql
SELECT id + 1 as id, username FROM users u WHERE id = $1;
```

![console output for example #2](./images/example-2.gif?raw=true)

See? In the previous version, we have **INTEGER** column with **UNIQUE** constraint, and now we have **SMALLINT** with **PRIMARY**, but the result type is **INTEGER** anyway. How it is possible?
Operator **"+"** with arguments **SMALLINT** and **INTEGER** in Postgresql returns **INTEGER**.

Ok, but why both are **NOT NULL**?
Because of where clause ```id = $1``` guarantee non-nullable result. If \$1 is not **NULL** and \$1 value present in the table, the result will contain \$1. But if \$1 = **NULL**, this query return none of the rows.

But what wrong? Why did it fail? Because the kind of the field was changed! Previous it was a column, but now it is a dynamic expression.

## Example #3
Ok, last try. Let's do some crazy thing right now!

Add and push new DDL elements:
```sql
CREATE TABLE users_login_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users,
  date DATE DEFAULT NOW() NOT NULL
);

CREATE VIEW view_users AS 
  SELECT u.username, ulh.* 
  FROM users u 
  LEFT JOIN users_login_history ulh ON u.id = ulh.user_id;
```

Push following DML:
```sql
SELECT * FROM view_users;
```

Then replace it with
```sql
WITH a(username) AS (
  WITH b(username1, id2, user_id3, date4) AS (
    SELECT * FROM view_users
  )
  SELECT username1, id2 AS id, user_id3 as user_id, date4 as date FROM b
)
SELECT * FROM a
;
```
Absolutely cursed...

![console output for example #3](./images/example-3.gif?raw=true)

WHAT?! WHY?! Why is everything ok?
**kind, name, type, nullability**, and **row count class** are the same. Moreover, the **origin** of all fields is the same!

These are two identical queries. Literally. Same source, same meanings. **And now you can trace this!**

# HOW IT WORKS
All this magic made by our SaaS named **[parsers.dev](https://parsers.dev)**. Yes, this is online tool and you need to register (it is free).
We take all database schema definition and 



# HOW TO INSTALL
You can use it without installation with **npx**:
```sh
npx @parsers.dev/sql-type-tracker --ddl=<path-to-ddl-dir-or-file> --dml=<path-to-dml-dir-or-file> --apikey=<parsers.dev api key>
```

or you can install it (globally or locally - it is faster):
```sh
npm i @parsers.dev/sql-type-tracker -g
parsers-dev-sql-type-tracker --ddl=<path-to-ddl-dir-or-file> --dml=<path-to-dml-dir-or-file> --apikey=<parsers.dev api key>
```

# PARAMS
  * **ddl** - file or directory with schema declaration
  * **dml** - file or directory with queries
  * **apikey** - key from **[parsers.dev](https://parsers.dev)** client area. Don't  forget to register - it takes a few clicks, and it's **FREE** 😀


# SUPPORTED DATABASES
Now we support **Postgersql 13** dialect only. **Snowflake** will be supported in the nearest future. Subscribe at **[parsers.dev](https://parsers.dev)**!

# NOTICE
You can set DDL and DML as a file or as a directory. Multi-files DDL is supported!

Note multi-statements DML files do not support yet!

**Just put all your queries in separate files!**

# WHAT'S NEXT?
Next step - start to use a static analyzer for your projects. It's here - **[holistic.dev](https://holistic.dev)**
Tons of recommendations about performance, architecture, and even security!
**And it's still based on DDL+DML source code only!**
You can check queries from DB log (pg_stat_statement in Postgresql) automatically!
Doesn't matter you write raw SQL queries or using ORM. All DDL and DML store in DB as a SQL-query 😀


# TODO
 - [ ] typescript
 - [ ] tests
 - [ ] branches compare
 - [ ] commits compare
 - [ ] respect type aliases
 - [ ] replace console.log with some template engine
 - [ ] various result formats - json, text, table...

 **Feel free to create a pull request!**