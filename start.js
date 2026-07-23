const { spawn } = require("child_process");

function startProcess(name, command, args) {
    console.log(`🚀 Starte ${name}...`);

    const child = spawn(command, args, {
        stdio: "inherit",
        env: process.env
    });

    child.on("error", (error) => {
        console.error(`❌ ${name} konnte nicht gestartet werden:`, error);
    });

    child.on("close", (code) => {
        console.log(`⚠️ ${name} beendet mit Code ${code}`);
    });

    return child;
}

// Dashboard startet unabhängig vom Discord-Bot.
// Wenn Discord wegen Intents/Token crasht, bleibt das Teamboard trotzdem erreichbar.
startProcess("Teamboard", "node", ["server.js"]);
startProcess("Discord-Bot", "node", ["index.js"]);
