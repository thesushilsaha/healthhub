const path = require("path");
const Datastore = require("@seald-io/nedb");

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

class SQLStrategy {
    constructor(dbName) {
        this.dbName = dbName;
        console.log(`[SQLStrategy] Initialized for ${dbName}`);
    }

    find(query, callback) {
        console.log(`[SQLStrategy] find on ${this.dbName} with query:`, query);
        callback(null, []);
    }

    findOne(query, callback) {
        console.log(`[SQLStrategy] findOne on ${this.dbName} with query:`, query);
        callback(null, null);
    }

    insert(doc, callback) {
        console.log(`[SQLStrategy] insert on ${this.dbName}:`, doc);
        callback(null, doc);
    }

    update(query, updateDoc, options, callback) {
        console.log(`[SQLStrategy] update on ${this.dbName} query:`, query, "update:", updateDoc);
        callback(null, 1, updateDoc);
    }

    remove(query, callback) {
        console.log(`[SQLStrategy] remove on ${this.dbName} query:`, query);
        callback(null, 1);
    }

    ensureIndex(options, callback) {
        console.log(`[SQLStrategy] ensureIndex on ${this.dbName}:`, options);
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
        
        const appName = process.env.APPNAME || "PharmaSpot";
        
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
