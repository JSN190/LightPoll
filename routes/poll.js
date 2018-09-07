const path = require("path");
const database = require(path.join(__dirname, "../database.js"));
const express = require("express");
const router = express.Router();
const { check, param, validationResult } = require("express-validator/check");

router.get("/poll/:id", [param("id").isNumeric()], async (req, res) => {
    res.type("application/json");
    const errors = validationResult(req);
    if (errors.isEmpty()) {
        try { 
            const record = await database.query({
                text: "SELECT polls.*, count(poll_votes.id) AS total_votes FROM polls \
                    LEFT JOIN poll_votes ON polls.id = poll_votes.poll_id WHERE polls.id=$1 \
                    GROUP BY polls.id",
                values: [req.params.id]
            });
            if (record.rows.length !== 1) {
                res.status(404);
                res.send({ error: true, details: `Poll ${req.params.id} not found.`});
                return;
            }
            const options = await database.query({
                text: "SELECT poll_options.id, poll_options.value, count(poll_votes.id) AS votes \
                FROM poll_options LEFT JOIN poll_votes ON poll_options.id = poll_votes.poll_option_id \
                WHERE poll_options.poll_id=$1 GROUP BY poll_options.id",
                values: [record.rows[0].id]
            });
            res.send({ 
                id: Number(record.rows[0].id),
                name: record.rows[0].name,
                description: record.rows[0].description,
                options: options.rows.map(e => { return { id: Number(e.id), value: e.value, votes: Number(e.votes) } }),
                totalVotes: Number(record.rows[0].total_votes),
                created: record.rows[0].created
            });
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

router.delete("/poll/:id", [param("id").isNumeric()], async (req, res) => {
    res.type("application/json");
    const errors = validationResult(req);
    if (errors.isEmpty()) {
        const client = await database.connect();
        try {
            await client.query("BEGIN");
            await client.query({
                text: "DELETE FROM poll_votes WHERE poll_id=$1",
                values: [req.params.id]
            });
            await client.query({
                text: "DELETE FROM poll_options WHERE poll_id=$1",
                values: [req.params.id]
            });
            await client.query({
                text: "DELETE FROM polls WHERE id=$1",
                values: [req.params.id]
            });
            await client.query("COMMIT");
            res.send({ success: true, id: Number(req.params.id) });
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
        check("name").exists().isAscii().isLength({ max: 140 }),
        check("description").optional().isAscii().isLength({ max: 500 }),
        check("options").exists().custom((options) => {
            if (!Array.isArray(options) || options.length < 2) return false;
            for (let option of options) if (option.length > 140) return false;    
            return true;
        })
    ], async (req, res) => {
        res.type("application/json");
        const errors = validationResult(req);
        if (errors.isEmpty()) {
            const client = await database.connect();
            try {
                await client.query("BEGIN");
                const description = req.body.description ? req.body.description : "";
                const insertAndGetId = await client.query({
                    text: "INSERT INTO polls (name, description, created) \
                        VALUES ($1, $2, to_timestamp($3 / 1000.0)) RETURNING id",
                    values: [req.body.name, description, Date.now()]
                });
                for (let option of req.body.options) {
                    await client.query({
                        text: "INSERT INTO poll_options (poll_id, value, created) \
                            VALUES ($1, $2, to_timestamp($3 / 1000.0))",
                        values: [insertAndGetId.rows[0].id, option, Date.now()]
                    });
                }
                await client.query("COMMIT");
                res.send({ success: true, poll_id: insertAndGetId.rows[0].id });
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

module.exports = router;