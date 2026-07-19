const fs = require('fs');
const path = require('path');

// 1. Manually load .env variables
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf-8');
    envConfig.split('\n').forEach(line => {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (match) {
            const key = match[1];
            let value = match[2] || '';
            value = value.replace(/(^['"]|['"]$)/g, '').trim();
            process.env[key] = value;
        }
    });
}

// Force SQL Strategy for the migration process
process.env.DB_STRATEGY = "sql";

const { getDatabase } = require("./api/db");
const { Pool } = require("pg");

const poolConfig = {
    host: process.env.PGHOST || "localhost",
    port: parseInt(process.env.PGPORT || "5432"),
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "",
    database: process.env.PGDATABASE || "healthhub"
};

const pool = new Pool(poolConfig);

const databases = ["users", "categories", "customers", "settings", "inventory", "batches", "transactions"];

async function migrate() {
    console.log("Starting NeDB to PostgreSQL Migration...");
    console.log("Connecting to PostgreSQL at", poolConfig.host + ":" + poolConfig.port);
    
    try {
        // Test connection
        await pool.query("SELECT NOW()");
        console.log("Connected successfully to PostgreSQL");
        
        // Find NeDB files
        const appData = process.env.APPDATA || path.join(__dirname, "data");
        const appName = process.env.APPNAME || "HealthHub";
        const nedbDir = path.join(appData, appName, "server", "databases");
        
        console.log("Searching for NeDB files in:", nedbDir);
        if (!fs.existsSync(nedbDir)) {
            console.error("NeDB database directory not found. Please ensure the app has run at least once or that the database files are present.");
            process.exit(1);
        }

        // Initialize schemas in Postgres
        const dbHelper = getDatabase("users"); 
        
        for (const dbName of databases) {
            const dbFile = path.join(nedbDir, `${dbName}.db`);
            if (!fs.existsSync(dbFile)) {
                console.log(`No NeDB file found for [${dbName}], skipping.`);
                continue;
            }
            
            console.log(`\nMigrating table [${dbName}] from:`, dbFile);
            
            // Clear existing data in Postgres table to prevent duplicate primary keys
            console.log(`Clearing existing Postgres table [${dbName}]...`);
            await pool.query(`TRUNCATE TABLE ${dbName} CASCADE`);
            
            const fileContent = fs.readFileSync(dbFile, 'utf8');
            const lines = fileContent.split('\n');
            let successCount = 0;
            let errorCount = 0;
            
            const targetDb = getDatabase(dbName);
            
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const doc = JSON.parse(line);
                    
                    // NeDB stores schema/index internal info in $$deleted and similar lines. Skip them.
                    if (doc.$$deleted || doc.$$indexCreated) continue;
                    
                    await new Promise((resolve, reject) => {
                        targetDb.insert(doc, (err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    });
                    successCount++;
                } catch (lineErr) {
                    console.error(`Error inserting document into [${dbName}]:`, lineErr.message);
                    errorCount++;
                }
            }
            console.log(`Finished [${dbName}]: successfully migrated ${successCount} documents (${errorCount} errors)`);
        }
        
        console.log("\nMigration completed successfully.");
    } catch (err) {
        console.error("Fatal migration error:", err);
    } finally {
        await pool.end();
    }
}

migrate();
