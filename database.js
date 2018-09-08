const { Pool } = require("pg");
const pool = new Pool({
    connectionString: process.env.LIGHTPOLL_DB
});

async function initialise () {
    const client = await pool.connect();
    try {
        const createUsers = "CREATE TABLE IF NOT EXISTS users \
            (id bigserial PRIMARY KEY, \
            username varchar(30) UNIQUE NOT NULL, \
            passHash text NOT NULL, \
            created timestamp NOT NULL)";
        const createPolls = "CREATE TABLE IF NOT EXISTS polls \
            (id bigserial PRIMARY KEY, \
            name varchar(140) NOT NULL, \
            description varchar(500) NOT NULL, \
            owner_id bigint REFERENCES users (id) ON DELETE CASCADE, \
            created timestamp NOT NULL, \
            modified timestamp)";
        const createPollOptions = "CREATE TABLE IF NOT EXISTS poll_options \
            (id bigserial PRIMARY KEY, \
            poll_id bigint REFERENCES polls (id) ON DELETE CASCADE NOT NULL, \
            value varchar(140) NOT NULL, \
            created timestamp NOT NULL)";
        const createPollVotes = "CREATE TABLE IF NOT EXISTS poll_votes \
            (id bigserial PRIMARY KEY, \
            poll_id bigint REFERENCES polls (id) NOT NULL, \
            poll_option_id bigint REFERENCES poll_options (id) ON DELETE CASCADE NOT NULL, \
            created timestamp NOT NULL)";
        const setPollModified = "CREATE FUNCTION set_poll_modified() RETURNS \
            TRIGGER AS $$ BEGIN NEW.modified :=NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql; \
            CREATE TRIGGER set_poll_modified BEFORE UPDATE ON polls FOR EACH ROW \
            EXECUTE PROCEDURE set_poll_modified();";
        await client.query(createUsers);
        await client.query(createPolls);
        await client.query(createPollOptions);
        await client.query(createPollVotes);
        //await client.query(setPollModified);
        await client.query("COMMIT");
        console.log(`Connected to PostgreSQL.`);
    } catch (e) {
        await client.query("ROLLBACK");
        console.log(e);
    } finally {
        client.release();
    }
}

module.exports = {
    initialise,
    query: (statement, params) => pool.query(statement, params),
    connect: () => pool.connect()
}