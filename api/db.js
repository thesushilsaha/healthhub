const path = require("path");
const Datastore = require("@seald-io/nedb");
const { Pool } = require("pg");

// Configuration from environment variables
const poolConfig = {
    host: process.env.PGHOST || "localhost",
    port: parseInt(process.env.PGPORT || "5432"),
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "",
    database: process.env.PGDATABASE || "healthhub"
};

let pool = null;
if (process.env.DB_STRATEGY === "sql") {
    pool = new Pool(poolConfig);
}

// Global schema initialization state
let schemaInitialized = false;
let initPromise = null;

async function initializeSchema(activePool) {
    if (schemaInitialized) return;
    const client = await activePool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id BIGINT PRIMARY KEY,
                username TEXT,
                data JSONB
            );
            CREATE TABLE IF NOT EXISTS categories (
                id BIGINT PRIMARY KEY,
                data JSONB
            );
            CREATE TABLE IF NOT EXISTS customers (
                id BIGINT PRIMARY KEY,
                data JSONB
            );
            CREATE TABLE IF NOT EXISTS settings (
                id INT PRIMARY KEY,
                data JSONB
            );
            CREATE TABLE IF NOT EXISTS inventory (
                id BIGINT PRIMARY KEY,
                barcode TEXT,
                data JSONB
            );
            CREATE TABLE IF NOT EXISTS batches (
                id TEXT PRIMARY KEY,
                productId BIGINT,
                data JSONB
            );
            CREATE TABLE IF NOT EXISTS transactions (
                id TEXT PRIMARY KEY,
                status INTEGER,
                ref_number TEXT,
                date TEXT,
                customer TEXT,
                data JSONB
            );
        `);
        console.log("[SQLStrategy] Postgres schemas initialized successfully");
        schemaInitialized = true;
    } catch (err) {
        console.error("[SQLStrategy] Error initializing database schemas:", err);
        throw err;
    } finally {
        client.release();
    }
}

function getInitPromise() {
    if (!pool) return Promise.resolve();
    if (!initPromise) {
        initPromise = initializeSchema(pool);
    }
    return initPromise;
}

class NeDBStrategy {
    constructor(dbName, dbPath, options = {}) {
        this.db = new Datastore({
            filename: dbPath,
            autoload: true,
            ...options
        });
    }

    find(query, callback) {
        return this.db.find(query, callback);
    }

    findOne(query, callback) {
        return this.db.findOne(query, callback);
    }

    insert(doc, callback) {
        return this.db.insert(doc, callback);
    }

    update(query, updateDoc, options, callback) {
        return this.db.update(query, updateDoc, options, callback);
    }

    remove(query, callback) {
        return this.db.remove(query, callback);
    }

    ensureIndex(options, callback) {
        return this.db.ensureIndex(options, callback);
    }
}

class SQLCursor {
    constructor(strategy, query) {
        this.strategy = strategy;
        this.query = query;
        this.sortObj = null;
    }

    sort(sortObj) {
        this.sortObj = sortObj;
        return this;
    }

    exec(callback) {
        this.strategy._executeFind(this.query, this.sortObj, callback);
    }
}

class SQLStrategy {
    constructor(dbName) {
        this.dbName = dbName;
        console.log(`[SQLStrategy] Initialized for ${dbName}`);
    }

    generateId() {
        return Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
    }

    mongoToSql(query) {
        if (!query || Object.keys(query).length === 0) {
            return { where: "1=1", values: [] };
        }

        const clauses = [];
        const values = [];
        let paramIndex = 1;

        function parseNode(node) {
            if (node.$and && Array.isArray(node.$and)) {
                const subClauses = [];
                for (const subNode of node.$and) {
                    const parsed = parseNode(subNode);
                    if (parsed.clause) {
                        subClauses.push(`(${parsed.clause})`);
                    }
                }
                return { clause: subClauses.join(" AND ") };
            }

            const itemClauses = [];
            for (const [key, value] of Object.entries(node)) {
                let columnName = key === "_id" ? "id" : key;

                // Handle nested operator queries
                if (value && typeof value === "object" && !Array.isArray(value)) {
                    for (const [op, opVal] of Object.entries(value)) {
                        if (op === "$ne") {
                            if (opVal === "") {
                                itemClauses.push(`${columnName} <> '' AND ${columnName} IS NOT NULL`);
                            } else {
                                values.push(opVal);
                                itemClauses.push(`${columnName} <> $${paramIndex++}`);
                            }
                        } else if (op === "$gte") {
                            values.push(opVal);
                            itemClauses.push(`${columnName} >= $${paramIndex++}`);
                        } else if (op === "$lte") {
                            values.push(opVal);
                            itemClauses.push(`${columnName} <= $${paramIndex++}`);
                        }
                    }
                } else {
                    // Exact value match
                    values.push(value);
                    itemClauses.push(`${columnName} = $${paramIndex++}`);
                }
            }
            return { clause: itemClauses.join(" AND ") };
        }

        const parsed = parseNode(query);
        return {
            where: parsed.clause || "1=1",
            values
        };
    }

    async _executeFind(query, sortObj, callback) {
        try {
            await getInitPromise();
            const { where, values } = this.mongoToSql(query);
            const sql = `SELECT data FROM ${this.dbName} WHERE ${where}`;
            const res = await pool.query(sql, values);
            const results = res.rows.map(row => {
                const doc = row.data;
                return doc;
            });

            if (sortObj) {
                const keys = Object.keys(sortObj);
                results.sort((a, b) => {
                    for (const key of keys) {
                        const direction = sortObj[key];
                        const valA = a[key];
                        const valB = b[key];
                        if (valA < valB) return -1 * direction;
                        if (valA > valB) return 1 * direction;
                    }
                    return 0;
                });
            }

            if (callback) callback(null, results);
        } catch (err) {
            console.error(`[SQLStrategy] find error on ${this.dbName}:`, err);
            if (callback) callback(err);
        }
    }

    find(query, callback) {
        if (!callback) {
            return new SQLCursor(this, query);
        }
        this._executeFind(query, null, callback);
    }

    async findOne(query, callback) {
        try {
            await getInitPromise();
            const { where, values } = this.mongoToSql(query);
            const sql = `SELECT data FROM ${this.dbName} WHERE ${where} LIMIT 1`;
            const res = await pool.query(sql, values);
            const result = res.rows.length > 0 ? res.rows[0].data : null;
            if (callback) callback(null, result);
        } catch (err) {
            console.error(`[SQLStrategy] findOne error on ${this.dbName}:`, err);
            if (callback) callback(err);
        }
    }

    async insert(doc, callback) {
        try {
            await getInitPromise();
            const docToInsert = { ...doc };
            
            // Handle primary key extraction
            if (docToInsert._id === undefined || docToInsert._id === null) {
                docToInsert._id = this.generateId();
            }

            const id = docToInsert._id;
            let queryText = "";
            let values = [];

            // Expose primary/search keys into columns for fast querying and indexing
            if (this.dbName === "users") {
                queryText = `INSERT INTO users (id, username, data) VALUES ($1, $2, $3) RETURNING data`;
                values = [id, docToInsert.username || null, docToInsert];
            } else if (this.dbName === "inventory") {
                queryText = `INSERT INTO inventory (id, barcode, data) VALUES ($1, $2, $3) RETURNING data`;
                values = [id, docToInsert.barcode || null, docToInsert];
            } else if (this.dbName === "batches") {
                queryText = `INSERT INTO batches (id, productId, data) VALUES ($1, $2, $3) RETURNING data`;
                values = [id, docToInsert.productId || null, docToInsert];
            } else if (this.dbName === "transactions") {
                queryText = `INSERT INTO transactions (id, status, ref_number, date, customer, data) VALUES ($1, $2, $3, $4, $5, $6) RETURNING data`;
                values = [id, docToInsert.status !== undefined ? docToInsert.status : null, docToInsert.ref_number || null, docToInsert.date || null, docToInsert.customer || null, docToInsert];
            } else {
                queryText = `INSERT INTO ${this.dbName} (id, data) VALUES ($1, $2) RETURNING data`;
                values = [id, docToInsert];
            }

            const res = await pool.query(queryText, values);
            const inserted = res.rows[0].data;
            if (callback) callback(null, inserted);
        } catch (err) {
            console.error(`[SQLStrategy] insert error on ${this.dbName}:`, err);
            if (callback) callback(err);
        }
    }

    async update(query, updateDoc, options, callback) {
        try {
            await getInitPromise();
            const { where, values: queryValues } = this.mongoToSql(query);

            // Fetch the documents we are going to update
            const selectSql = `SELECT id, data FROM ${this.dbName} WHERE ${where}`;
            const selectRes = await pool.query(selectSql, queryValues);

            let numUpdated = 0;
            const updatedDocs = [];

            for (const row of selectRes.rows) {
                const currentDoc = row.data;
                let newDoc = { ...currentDoc };

                if (updateDoc.$set) {
                    // Patch update
                    newDoc = { ...newDoc, ...updateDoc.$set };
                } else {
                    // Replacement update
                    newDoc = { ...updateDoc };
                    newDoc._id = currentDoc._id; // Preserve original NeDB _id
                }

                // Prepare SQL parameters
                let updateSql = "";
                let updateValues = [];

                if (this.dbName === "users") {
                    updateSql = `UPDATE users SET username = $1, data = $2 WHERE id = $3`;
                    updateValues = [newDoc.username || null, newDoc, row.id];
                } else if (this.dbName === "inventory") {
                    updateSql = `UPDATE inventory SET barcode = $1, data = $2 WHERE id = $3`;
                    updateValues = [newDoc.barcode || null, newDoc, row.id];
                } else if (this.dbName === "batches") {
                    updateSql = `UPDATE batches SET productId = $1, data = $2 WHERE id = $3`;
                    updateValues = [newDoc.productId || null, newDoc, row.id];
                } else if (this.dbName === "transactions") {
                    updateSql = `UPDATE transactions SET status = $1, ref_number = $2, date = $3, customer = $4, data = $5 WHERE id = $6`;
                    updateValues = [
                        newDoc.status !== undefined ? newDoc.status : null,
                        newDoc.ref_number || null,
                        newDoc.date || null,
                        newDoc.customer || null,
                        newDoc,
                        row.id
                    ];
                } else {
                    updateSql = `UPDATE ${this.dbName} SET data = $1 WHERE id = $2`;
                    updateValues = [newDoc, row.id];
                }

                await pool.query(updateSql, updateValues);
                numUpdated++;
                updatedDocs.push(newDoc);
            }

            if (callback) callback(null, numUpdated, updatedDocs.length > 0 ? updatedDocs[0] : null);
        } catch (err) {
            console.error(`[SQLStrategy] update error on ${this.dbName}:`, err);
            if (callback) callback(err);
        }
    }

    async remove(query, callback) {
        try {
            await getInitPromise();
            const { where, values } = this.mongoToSql(query);
            const sql = `DELETE FROM ${this.dbName} WHERE ${where}`;
            const res = await pool.query(sql, values);
            if (callback) callback(null, res.rowCount);
        } catch (err) {
            console.error(`[SQLStrategy] remove error on ${this.dbName}:`, err);
            if (callback) callback(err);
        }
    }

    ensureIndex(options, callback) {
        // Handled silently since Postgres supports standard table indexes if needed
        if (callback) callback(null);
    }
}

const instances = {};

function getDatabase(dbName, onInit) {
    if (instances[dbName]) {
        return instances[dbName];
    }

    const strategy = process.env.DB_STRATEGY || "nedb";
    let dbInstance;

    if (strategy === "nedb") {
        const appData = process.env.NODE_ENV === 'test' 
            ? path.join(__dirname, "..", "tests", "tmp-db")
            : (process.env.APPDATA || path.join(__dirname, "..", "data"));
        
        const appName = process.env.APPNAME || "HealthHub";
        
        const dbPath = path.join(
            appData,
            appName,
            "server",
            "databases",
            `${dbName}.db`
        );
        dbInstance = new NeDBStrategy(dbName, dbPath);
    } else {
        dbInstance = new SQLStrategy(dbName);
    }

    if (onInit) {
        onInit(dbInstance);
    }

    instances[dbName] = dbInstance;
    return dbInstance;
}

module.exports = {
    getDatabase,
    NeDBStrategy,
    SQLStrategy
};
