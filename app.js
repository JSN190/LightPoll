require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");
const path = require("path");

// Database
const database = require(path.join(__dirname, "./database.js"));
database.initialise();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({
    extended: true
}));

// Routes
const pollRoutes = require(path.join(__dirname, "./routes/poll.js"));
app.use(pollRoutes);

app.listen(process.env.LIGHTPOLL_PORT, () => {
    console.log(`Started Express.js on port ${process.env.LIGHTPOLL_PORT}.`);
});