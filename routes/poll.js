const path = require("path");
const database = require(path.join(__dirname, "../database.js"));
const express = require("express");
const router = express.Router();
const check = require("express-validator/check");
const uidGen = new (require("uid-generator"))(256);
const bcrypt = require("bcrypt");
const sjcl = require("sjcl");
const jwt = require("jsonwebtoken");

const streams = [];

router.get("/poll/:id", [check.param("id").isNumeric()], async (req, res) => {
    res.type("application/json");
    const errors = check.validationResult(req);
    if (errors.isEmpty()) {
        try { 
            const poll = await getPollAndVotes(req.params.id);
            if (!poll) {
                res.status(404);
                res.send({ error: true, details: `Poll ${req.params.id} not found.` });
                return;
            }
            res.send(poll);
        } catch (e) {
            console.log(e);
            res.status(500);
            res.send({ error: true });
        }
    } else {
        res.status(400);
        res.send({ error: true, details: errors.array() });
    }
});

router.delete("/poll/:id", [
    check.param("id").isNumeric(),
    check.body("editToken").optional().isAlphanumeric()
    ], 
    async (req, res) => {
        res.type("application/json");
        const errors = check.validationResult(req);
        if (errors.isEmpty()) {
            const client = await database.connect();
            try {
                await client.query("BEGIN");
                const poll = (await client.query({
                    text: "SELECT * FROM polls WHERE id=$1",
                    values: [req.params.id]
                }));
                if (poll.rows.length !== 1) {
                    res.status(404);
                    res.send({ error: true, details: `Poll ${req.params.id} not found.`});
                    return;
                }
                let token  = req.headers["x-access-token"];
                try { token = jwt.verify(token, process.env.LIGHTPOLL_JWT) } 
                catch { token = null }
                const haveEditToken = req.body.editToken ? await bcrypt.compare(req.body.editToken, 
                    poll.rows[0].edit_token) : false;
                const isOwner = token ? token.id === Number(poll.rows[0].owner_id) : false;
                if (!haveEditToken && !isOwner ) {
                    res.status(401);
                    res.send({ 
                        error: true,
                        details: `You do not have permission to delete poll ${req.params.id}.` 
                    });
                    return;
                }
                await client.query({
                    text: "DELETE FROM polls WHERE id=$1",
                    values: [req.params.id]
                });
                await client.query("COMMIT");
                res.send({ success: true, operation: "deletePoll", id: Number(req.params.id) });
            } catch (e) {
                await client.query("ROLLBACK");
                console.log(e);
                res.status(500);
                res.send({ error: true });
            } finally {
                client.release();
            }
        } else {
            res.status(400);
            res.send({ error: true, details: errors.array() });
        }
});

router.put("/poll/:id", [
    check.param("id").exists().isNumeric(),
    check.body("name").exists().isAscii().isLength({ max: 140 }),
    check.body("description").optional().isAscii().isLength({ max: 500 }),
    check.body("enforceUnique").exists().isBoolean(),
    check.body("anonymous").exists().isBoolean(),
    check.body("options").exists().custom((options) => {
        if (!Array.isArray(options) || options.length < 2) return false;
            let existing = [];
            for (let option of options) {
                if (option.length > 140 || existing.includes(option)) return false;
                existing.push(option);
            }
            return true;
    }),
    check.body("editToken").optional().isAlphanumeric()
], async (req, res) => {
    res.type("application/json");
    const errors = check.validationResult(req);
    if (errors.isEmpty()) {
        const client = await database.connect();
        try {
            await client.query("BEGIN");
            const description = req.body.description ? req.body.description : "";
            const poll = await client.query({
                text: "SELECT * FROM polls WHERE id=$1",
                values: [req.params.id]
            });
            if (poll.rows.length !== 1) {
                res.status(404);
                res.send({ error: true, details: `Poll ${req.params.id} not found.`});
                return;
            }
            let token  = req.headers["x-access-token"];
            try { token = jwt.verify(token, process.env.LIGHTPOLL_JWT) } 
            catch { token = null }
            const haveEditToken = req.body.editToken ? await bcrypt.compare(req.body.editToken, 
                poll.rows[0].edit_token) : false;
            const isOwner = token ? token.id === Number(poll.rows[0].owner_id) : false;
            const ownerId = req.body.anonymous ? null : token ? token.id : poll.rows[0].owner_id;
            if (!haveEditToken && !isOwner ) {
                res.status(401);
                res.send({ 
                    error: true,
                    details: `You do not have permission to edit poll ${req.params.id}.` 
                });
                return;
            }
            await client.query({
                text: "UPDATE polls SET name=$1, description=$2, modified=to_timestamp($3/1000.0), \
                enforce_unique=$4, owner_id=$5 WHERE id=$6",
                values: [req.body.name, description, Date.now(), req.body.enforceUnique,
                    ownerId, req.params.id]
            });
            await client.query({
                text: "DELETE FROM poll_options WHERE NOT(value = ANY($1)) AND poll_id=$2",
                values: [req.body.options, req.params.id]
            });
            const remainingOptions = (await client.query({
                text: "SELECT value from poll_options WHERE poll_id=$1",
                values: [req.params.id]
            })).rows.map(row => row.value);
            for (let option of req.body.options.filter(e => !remainingOptions.includes(String(e)))) {
                await client.query({
                    text: "INSERT INTO poll_options (poll_id, value, created) \
                        VALUES ($1, $2, to_timestamp($3/1000.0))",
                    values: [req.params.id, option, Date.now()]
                });
            }
            await client.query("COMMIT");
            res.send({ 
                success: true, 
                operation: "updatePoll", 
                poll_id: Number(req.params.id),
            });
        } catch (e) {
            await client.query("ROLLBACK");
            console.log(e);
            res.status(500);
            res.send({ error: true });
        } finally {
            client.release();
        }
    } else {
        res.status(400);
        res.send({ error: true, details: errors.array() });
    }
});

router.post("/poll", [
        check.body("name").exists().isAscii().isLength({ max: 140 }),
        check.body("description").optional().isAscii().isLength({ max: 500 }),
        check.body("enforceUnique").exists().isBoolean(),
        check.body("anonymous").exists().isBoolean(),
        check.body("options").exists().custom((options) => {
            if (!Array.isArray(options) || options.length < 2) return false;
            let existing = [];
            for (let option of options) {
                if (option.length > 140 || existing.includes(option)) return false;
                existing.push(option);
            }
            return true;
        })
    ], async (req, res) => {
        res.type("application/json");
        const errors = check.validationResult(req);
        if (errors.isEmpty()) {
            const client = await database.connect();
            try {
                await client.query("BEGIN");
                const editToken = await uidGen.generate();
                const editTokenHash = await bcrypt.hash(editToken, 12);
                const description = req.body.description ? req.body.description : "";
                let token  = req.headers["x-access-token"];
                try { token = jwt.verify(token, process.env.LIGHTPOLL_JWT) } 
                catch { token = null }
                const ownerId =  req.body.anonymous ? null : token ? token.id : null;
                const insertAndGetId = await client.query({
                    text: "INSERT INTO polls (name, description, edit_token, enforce_unique, \
                        owner_id, created, modified) \
                        VALUES ($1, $2, $3, $4, $5, to_timestamp($6/1000.0), to_timestamp($6/1000.0)) \
                        RETURNING id",
                    values: [req.body.name, description, editTokenHash, req.body.enforceUnique, 
                            ownerId, Date.now()]
                });
                for (let option of req.body.options) {
                    await client.query({
                        text: "INSERT INTO poll_options (poll_id, value, created) \
                            VALUES ($1, $2, to_timestamp($3 / 1000.0))",
                        values: [insertAndGetId.rows[0].id, option, Date.now()]
                    });
                }
                await client.query("COMMIT");
                res.send({ 
                    success: true, 
                    operation: "createPoll", 
                    poll_id: Number(insertAndGetId.rows[0].id),
                    editToken
                })
            } catch (e) {
                await client.query("ROLLBACK");
                console.log(e);
                res.status(500);
                res.send({ error: true });
            } finally {
                client.release();
            }
        } else {
            res.status(400);
            res.send({ error: true, details: errors.array() });
        }
});

router.post("/poll/:id/vote", [
    check.body("value").exists().isAscii().isLength({ max: 140 }),
], async (req, res) => {
    res.type("application/json");
    const errors = check.validationResult(req);
    if (errors.isEmpty()) {
        const client = await database.connect();
        try {
            await client.query("BEGIN");
            const poll = await client.query({
                text: "SELECT enforce_unique FROM polls WHERE id=$1",
                values: [req.params.id]
            });
            const option = await client.query({
                text: "SELECT id FROM poll_options WHERE poll_id=$1 AND value=$2",
                values: [req.params.id, req.body.value]
            });
            if (poll.rows.length !== 1) {
                res.status(404);
                res.send({ error: true, details: `Poll ${req.params.id} not found.`});
                return;
            } else if (option.rows.length !== 1) {
                res.status(404);
                res.send({ error: true, details: `Option ${req.body.value} not found.`});
                return;
            }
            let token = req.headers["x-access-token"];
            try { token = jwt.verify(token, process.env.LIGHTPOLL_JWT) } 
            catch { token = null }
            const enforceUnique = poll.rows[0].enforce_unique;
            const hash = sjcl.codec.hex.fromBits(sjcl.hash.sha256.hash(req.headers["x-forwarded-for"] 
                        || req.connection.remoteAddress));
            if (enforceUnique) {
                const alreadyVoted = (await client.query({
                    text: "SELECT id FROM poll_votes WHERE poll_id=$1 \
                            AND (voter_id=$2 OR voter_ip=$3) ",
                    values: [req.params.id, token ? token.id : -1, hash]
                })).rows.length >= 1;
                if (alreadyVoted) {
                    res.status(403);
                    res.send({ error: true, details: "You have already voted." })
                    return;
                }
            }
            await client.query({
                text: "INSERT INTO poll_votes (poll_id, poll_option_id, voter_id, voter_ip, created) \
                    VALUES ($1, $2, $3, $4, to_timestamp($5/1000.0))",
                values: [req.params.id, option.rows[0].id, 
                        enforceUnique ? token ? token.id : null : null, 
                        enforceUnique ? hash : null, Date.now()]
            });
            await client.query("COMMIT");
            res.send({ success: true, operation: "vote", poll_id: req.params.id });
            const now = new Date();
            const response = JSON.stringify({
                poll: await getPollAndVotes(req.params.id),
                datetime: now.getTime(),
                datetimeString: now.toUTCString()
            });
            if (Array.isArray(streams[req.params.id])) {
                for (let listener of streams[req.params.id]) {
                    try {
                        listener.write(`event: vote\ndata: ${response}\n\n`);
                    } catch {
                        streams[req.params.id] = streams[req.params.id].filter(e => e !== listener);
                    }
                }
            }
        } catch (e) {
            await client.query("ROLLBACK");
            console.log(e);
            res.status(500);
            res.send({ error: true });
        } finally {
            client.release();
        }
    } else {
        res.status(400);
        res.send({ error: true, details: errors.array() });
    }
});

router.get("/poll/:id/stream", [check.param("id").isNumeric()], async (req, res) => {
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
    });
    res.write("event: message\ndata: Connected to stream.\n\n");
    const errors = check.validationResult(req);
    if (errors.isEmpty()) {
        try { 
            const poll = await getPollAndVotes(req.params.id);
            if (!poll) {
                res.write(`event: error\ndata: Poll ${req.params.id} not found.\n\n`);
                res.end();
                return;
            }
            res.write(`event: current\ndata: ${poll}\n\n`);
            if (!streams[req.params.id]) streams[req.params.id] = [];
            streams[req.params.id].push(res);
            setTimeout(() => {
                streams[req.params.id] = streams[req.params.id].filter(e => e !== res);
                res.write("event: timeout\ndata: Session timeout. Please reconnect.\n\n");
                setTimeout(() =>res.end(), 100);
            }, 500000);
        } catch (e) {
            console.log(e);
            res.write(`event: error\ndata: An unexpected error has occured.\n\n`);
            res.end();
        }
    } else {
        res.write(`event: error\ndata: Invalid poll ID.\n\n`);
        res.end();
    }
})

async function getPollAndVotes(id) {
    const record = await database.query({
        text: "SELECT polls.*, count(poll_votes.id) AS total_votes FROM polls \
            LEFT JOIN poll_votes ON polls.id = poll_votes.poll_id WHERE polls.id=$1 \
            GROUP BY polls.id",
        values: [id]
    });
    if (record.rows.length === 1) {
        const options = await database.query({
            text: "SELECT poll_options.id, poll_options.value, count(poll_votes.id) AS votes \
            FROM poll_options LEFT JOIN poll_votes ON poll_options.id = poll_votes.poll_option_id \
            WHERE poll_options.poll_id=$1 GROUP BY poll_options.id",
            values: [record.rows[0].id]
        });
        const votes = await database.query({
            text: "SELECT * FROM poll_votes WHERE poll_id=$1 ORDER BY created DESC",
            values: [id]
        });
        const voters = record.rows[0].enforce_unique ? Array.from(votes.rows.reduce((acc, v) => {
            if (!v.voter_id && !v.voter_ip) return acc;
            return acc.add(v.voter_id + v.voter_ip);
        }, new Set())).length : "unlimited";
        const poll = JSON.stringify({
            id: Number(record.rows[0].id),
            name: record.rows[0].name,
            description: record.rows[0].description,
            options: options.rows.map(e => {
                return {
                    value: e.value,
                    votes: Number(e.votes)
                }
            }),
            voters,
            totalVotes: Number(record.rows[0].total_votes),
            latestVote: votes.rows[0] ? Number(votes.rows[0].created) : null,
            created: record.rows[0].created,
            modified: record.rows[0].modified
        });
        return poll;
    }
    return false;
}

module.exports = router;