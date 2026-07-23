const express = require("express");
const path = require("path");

const app = express();
const PORT = 3000;

// Dashboard
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "views", "index.html"));
});

// API
let teamData = [];

app.get("/team", (req, res) => {
    res.json(teamData);
});