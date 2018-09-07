const path = require("path");
const database = require(path.join(__dirname, "../database.js"));
const express = require("express");
const router = express.Router();
const { check, validationResult } = require("express-validator/check");

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
            res.status(500);
            res.send({ error: true, details: errors.array() });
        }
});

module.exports = router;