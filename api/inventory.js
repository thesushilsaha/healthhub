const express = require("express");
const router = express.Router();
const bodyParser = require("body-parser");
const async = require("async");
const sanitizeFilename = require('sanitize-filename');
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const {filterFile} = require('../assets/js/utils');
const validFileTypes = [
    "image/jpg",
    "image/jpeg",
    "image/png",
    "image/webp"];
const maxFileSize = 2097152 //2MB = 2*1024*1024
const validator = require("validator");
const moment = require("moment");
const appName = process.env.APPNAME || "PharmaSpot";
const appData = process.env.APPDATA || path.join(__dirname, "..", "data");
const { getDatabase } = require("./db");

const storage = multer.diskStorage({
    destination: path.join(appData, appName, "uploads"),
    filename: function (req, file, callback) {
        callback(null, Date.now()+path.extname(file.originalname));
    },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: maxFileSize },
  fileFilter: filterFile,
}).single("imagename");


router.use(bodyParser.json());

module.exports = router;

const inventoryDB = getDatabase("inventory", (db) => {
    db.ensureIndex({ fieldName: "_id", unique: true });
});

const batchesDB = getDatabase("batches", (db) => {
    db.ensureIndex({ fieldName: "productId" });
});

function generateUniqueProductId(callback) {
    let candidateId = Number(`${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`);

    inventoryDB.findOne({ _id: candidateId }, function (err, existingProduct) {
        if (err) {
            callback(err);
            return;
        }

        if (existingProduct) {
            generateUniqueProductId(callback);
            return;
        }

        callback(null, candidateId);
    });
}

/**
 * GET endpoint: Get the welcome message for the Inventory API.
 *
 * @param {Object} req request object.
 * @param {Object} res response object.
 * @returns {void}
 */
router.get("/", function (req, res) {
    res.send("Inventory API");
});

/**
 * GET endpoint: Get product details by product ID.
 *
 * @param {Object} req request object with product ID as a parameter.
 * @param {Object} res response object.
 * @returns {void}
 */
router.get("/product/:productId", function (req, res) {
    if (!req.params.productId) {
        res.status(500).send("ID field is required.");
    } else {
        inventoryDB.findOne(
            {
                _id: parseInt(req.params.productId),
            },
            function (err, product) {
                if (err || !product) {
                    return res.send(product);
                }
                batchesDB.find({ productId: product._id }, function (bErr, batches) {
                    if (batches && batches.length > 0) {
                        let activeBatches = batches.filter(b => b.quantity > 0);
                        if (activeBatches.length > 0) {
                            product.quantity = activeBatches.reduce((sum, b) => sum + b.quantity, 0);
                            activeBatches.sort((a, b) => {
                                let dateA = moment(a.expiryDate, "DD-MMM-YYYY");
                                let dateB = moment(b.expiryDate, "DD-MMM-YYYY");
                                return dateA.diff(dateB);
                            });
                            product.expirationDate = activeBatches[0].expiryDate;
                        } else {
                            product.quantity = 0;
                        }
                    }
                    res.send(product);
                });
            },
        );
    }
});

/**
 * GET endpoint: Get details of all products.
 *
 * @param {Object} req request object.
 * @param {Object} res response object.
 * @returns {void}
 */
router.get("/products", function (req, res) {
    inventoryDB.find({}, function (err, products) {
        if (err || !products) {
            return res.send([]);
        }
        
        batchesDB.find({}, function (bErr, allBatches) {
            if (bErr || !allBatches) {
                return res.send(products);
            }
            
            // Group active batches by productId
            let batchesByProduct = {};
            allBatches.forEach(b => {
                if (b.quantity > 0) {
                    if (!batchesByProduct[b.productId]) {
                        batchesByProduct[b.productId] = [];
                    }
                    // Pre-calculate timestamp to avoid repeated parsing in sort
                    b.expiryTimestamp = moment(b.expiryDate, "DD-MMM-YYYY").valueOf();
                    batchesByProduct[b.productId].push(b);
                }
            });

            products.forEach(product => {
                let activeBatches = batchesByProduct[product._id];
                if (activeBatches && activeBatches.length > 0) {
                    product.quantity = activeBatches.reduce((sum, b) => sum + b.quantity, 0);
                    // Sort using pre-calculated timestamp
                    activeBatches.sort((a, b) => Math.sign(a.expiryTimestamp - b.expiryTimestamp));
                    product.expirationDate = activeBatches[0].expiryDate;
                } else {
                    product.quantity = 0;
                }
            });

            res.send(products);
        });
    });
});

/**
 * POST endpoint: Create or update a product.
 *
 * @param {Object} req request object with product data in the body.
 * @param {Object} res response object.
 * @returns {void}
 */
router.post("/product", function (req, res) {
    upload(req, res, function (err) {

        if (err) {
            if (err instanceof multer.MulterError) {
                console.error('Upload Error:', err);
                return res.status(400).json({
                    error: 'Upload Error',
                    message: err.message,
                });
            } else {
                console.error('Unknown Error:', err);
                return res.status(500).json({
                    error: 'Internal Server Error',
                    message: err.message,
                });
            }
        }

    let image = "";

    if (validator.escape(req.body.img) !== "") {
        image = sanitizeFilename(req.body.img);
    }

    if (req.file) {
        image = sanitizeFilename(req.file.filename);
    }


    if (validator.escape(req.body.remove) === "1") {
            try {
                let imgPath = path.join(
                appData,
                appName,
                "uploads",
                image,
                );

                if (!req.file) {
                fs.unlinkSync(imgPath);
                image = "";
                }
                
            } catch (err) {
                console.error(err);
                res.status(500).json({
                    error: "Internal Server Error",
                    message: "An unexpected error occurred.",
                });
            }

        }

    let Product = {
        _id: parseInt(validator.escape(req.body.id)),
        barcode: validator.escape(req.body.barcode),
        expirationDate: validator.escape(req.body.expirationDate),
        price: validator.escape(req.body.price),
        gst: Number(validator.escape(req.body.gst || "0")),
        hsnCode: validator.escape(req.body.hsnCode || ""),
        scheduleType: validator.escape(req.body.scheduleType || ""),
        genericName: validator.escape(req.body.genericName || ""),
        category: validator.escape(req.body.category),
        supplier: validator.escape(req.body.supplier || ""),
        quantity:
            validator.escape(req.body.quantity) == ""
                ? 0
                : parseInt(validator.escape(req.body.quantity)),
        name: validator.escape(req.body.name),
        stock: req.body.stock === "on" ? 0 : 1,
        minStock: validator.escape(req.body.minStock),
        img: image,
    };

    if (validator.escape(req.body.id) === "") {
        generateUniqueProductId(function (idErr, productId) {
            if (idErr) {
                console.error(idErr);
                res.status(500).json({
                    error: "Internal Server Error",
                    message: "An unexpected error occurred.",
                });
                return;
            }

            Product._id = productId;
            inventoryDB.insert(Product, function (err, product) {
                if (err) {
                    console.error(err);
                    res.status(500).json({
                        error: "Internal Server Error",
                        message: "An unexpected error occurred.",
                    });
                } else {
                    let initialBatch = {
                        productId: product._id,
                        batchNo: "BATCH-INITIAL",
                        mfgDate: "",
                        expiryDate: product.expirationDate,
                        quantity: product.quantity,
                        purchasePrice: product.price
                    };
                    batchesDB.insert(initialBatch, function(bErr, batch) {
                        if (bErr) console.error("Batch insert error:", bErr);
                        res.sendStatus(200);
                    });
                }
            });
        });
    } else {
        inventoryDB.update(
            {
                _id: parseInt(validator.escape(req.body.id)),
            },
            Product,
            {},
            function (err, numReplaced, product) {
                if (err) {
                    console.error(err);
                    res.status(500).json({
                        error: "Internal Server Error",
                        message: "An unexpected error occurred.",
                    });
                } else {
                    res.sendStatus(200);
                }
            },
        );
    }
    });
});

/**
 * DELETE endpoint: Delete a product by product ID.
 *
 * @param {Object} req request object with product ID as a parameter.
 * @param {Object} res response object.
 * @returns {void}
 */
router.delete("/product/:productId", function (req, res) {
    inventoryDB.remove(
        {
            _id: parseInt(req.params.productId),
        },
        function (err, numRemoved) {
            if (err) {
                console.error(err);
                res.status(500).json({
                    error: "Internal Server Error",
                    message: "An unexpected error occurred.",
                });
            } else {
                res.sendStatus(200);
            }
        },
    );
});

/**
 * POST endpoint: Find a product by SKU code.
 *
 * @param {Object} req request object with SKU code in the body.
 * @param {Object} res response object.
 * @returns {void}
 */

router.post("/product/sku", function (req, res) {
    let sku = validator.escape(req.body.skuCode);
    inventoryDB.findOne(
        {
            barcode: parseInt(sku),
        },
        function (err, doc) {
            if (err) {
                console.error(err);
                res.status(500).json({
                    error: "Internal Server Error",
                    message: "An unexpected error occurred.",
                });
            } else {
                res.send(doc);
            }
        },
    );
});

/**
 * Decrement inventory quantities based on a list of products in a transaction.
 *
 * @param {Array} products - List of products in the transaction.
 * @returns {void}
 */
router.decrementInventory = function (products) {
    async.eachSeries(products, function (transactionProduct, callback) {
        inventoryDB.findOne(
            { _id: parseInt(transactionProduct.id) },
            function (err, product) {
                if (!product || product.stock === 0) {
                    return callback();
                }

                let remainingToDeduct = parseInt(transactionProduct.quantity);

                // Fetch batches sorted by expiryDate ascending (FEFO)
                batchesDB.find({ productId: product._id }).sort({ expiryDate: 1 }).exec(function (bErr, batches) {
                    if (bErr || !batches || batches.length === 0) {
                        return callback();
                    }

                    async.eachSeries(batches, function (batch, batchCallback) {
                        if (remainingToDeduct <= 0 || batch.quantity <= 0) {
                            return batchCallback();
                        }

                        let deduction = Math.min(batch.quantity, remainingToDeduct);
                        batch.quantity -= deduction;
                        remainingToDeduct -= deduction;

                        batchesDB.update({ _id: batch._id }, { $set: { quantity: batch.quantity } }, {}, batchCallback);
                    }, function (err) {
                        // After batches are updated, recalculate total quantity for the product
                        batchesDB.find({ productId: product._id }, function (err, updatedBatches) {
                            let totalQuantity = updatedBatches.reduce((sum, b) => sum + b.quantity, 0);
                            inventoryDB.update(
                                { _id: product._id },
                                { $set: { quantity: totalQuantity } },
                                {},
                                callback
                            );
                        });
                    });
                });
            }
        );
    });
};

