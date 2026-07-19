const path = require("path");
const fs = require("fs");
const { getDatabase, NeDBStrategy, SQLStrategy } = require("../api/db");

describe("Database Strategy Layer", () => {
    const testDbDir = path.join(__dirname, "tmp-db");

    beforeAll(() => {
        process.env.NODE_ENV = "test";
    });

    afterAll(() => {
        if (fs.existsSync(testDbDir)) {
            try {
                fs.rmSync(testDbDir, { recursive: true, force: true });
            } catch (err) {
                console.error("Cleanup failed:", err);
            }
        }
    });

    test("should retrieve database strategy instances and cache them", () => {
        const db1 = getDatabase("test-cache");
        const db2 = getDatabase("test-cache");

        expect(db1).toBe(db2);
        expect(db1).toBeInstanceOf(NeDBStrategy);
    });

    test("should trigger the onInit callback exactly once", () => {
        let callCount = 0;
        const callback = (db) => {
            callCount++;
        };

        const db = getDatabase("test-init", callback);
        const dbCached = getDatabase("test-init", callback);

        expect(callCount).toBe(1);
    });

    test("should switch strategies based on DB_STRATEGY env var", () => {
        process.env.DB_STRATEGY = "sql";
        const sqlDb = getDatabase("test-sql");
        expect(sqlDb).toBeInstanceOf(SQLStrategy);

        delete process.env.DB_STRATEGY;
    });

    test("NeDBStrategy should support basic interface methods", (done) => {
        const db = getDatabase("test-methods");

        db.insert({ _id: 1, name: "Test Item" }, (err, doc) => {
            expect(err).toBeNull();
            expect(doc.name).toBe("Test Item");

            db.findOne({ _id: 1 }, (err, found) => {
                expect(err).toBeNull();
                expect(found.name).toBe("Test Item");
                done();
            });
        });
    });
});
