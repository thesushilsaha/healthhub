const express = require("express");
const router = express.Router();
const bodyParser = require("body-parser");
const async = require("async");
const Inventory = require("./inventory");
const { getDatabase } = require("./db");

router.use(bodyParser.json());

module.exports = router;

const transactionsDB = getDatabase("transactions", (db) => {
  db.ensureIndex({ fieldName: "_id", unique: true });
});
const inventoryDB = getDatabase("inventory");

/**
 * GET endpoint: Get the welcome message for the Transactions API.
 *
 * @param {Object} req request object.
 * @param {Object} res response object.
 * @returns {void}
 */
router.get("/", function (req, res) {
  res.send("Transactions API");
});

/**
 * GET endpoint: Get details of all transactions.
 *
 * @param {Object} req request object.
 * @param {Object} res response object.
 * @returns {void}
 */
router.get("/all", function (req, res) {
  transactionsDB.find({}, function (err, docs) {
    res.send(docs);
  });
});

/**
 * GET endpoint: Get on-hold transactions.
 *
 * @param {Object} req request object.
 * @param {Object} res response object.
 * @returns {void}
 */
router.get("/on-hold", function (req, res) {
  transactionsDB.find(
    { $and: [{ ref_number: { $ne: "" } }, { status: 0 }] },
    function (err, docs) {
      if (docs) res.send(docs);
    },
  );
});

/**
 * GET endpoint: Get customer orders with a status of 0 and an empty reference number.
 *
 * @param {Object} req request object.
 * @param {Object} res response object.
 * @returns {void}
 */
router.get("/customer-orders", function (req, res) {
  let query = { $and: [{ customer: { $ne: "0" } }, { status: 0 }] };
  if (process.env.DB_STRATEGY !== "sql") {
    query.$and.unshift({ customer: { $ne: 0 } });
  }

  transactionsDB.find(
    query,
    function (err, docs) {
      if (err) {
        console.error(err);
        return res.status(500).send(err);
      }
      res.send(docs || []);
    },
  );
});

/**
 * GET endpoint: Get transactions based on date, user, and till parameters.
 *
 * @param {Object} req request object with query parameters.
 * @param {Object} res response object.
 * @returns {void}
 */
router.get("/by-date", function (req, res) {
  let startDate = new Date(req.query.start);
  let endDate = new Date(req.query.end);

  if (req.query.user == 0 && req.query.till == 0) {
    transactionsDB.find(
      {
        $and: [
          { date: { $gte: startDate.toJSON(), $lte: endDate.toJSON() } },
          { status: parseInt(req.query.status) },
        ],
      },
      function (err, docs) {
        if (docs) res.send(docs);
      },
    );
  }

  if (req.query.user != 0 && req.query.till == 0) {
    transactionsDB.find(
      {
        $and: [
          { date: { $gte: startDate.toJSON(), $lte: endDate.toJSON() } },
          { status: parseInt(req.query.status) },
          { user_id: parseInt(req.query.user) },
        ],
      },
      function (err, docs) {
        if (docs) res.send(docs);
      },
    );
  }

  if (req.query.user == 0 && req.query.till != 0) {
    transactionsDB.find(
      {
        $and: [
          { date: { $gte: startDate.toJSON(), $lte: endDate.toJSON() } },
          { status: parseInt(req.query.status) },
          { till: parseInt(req.query.till) },
        ],
      },
      function (err, docs) {
        if (docs) res.send(docs);
      },
    );
  }

  if (req.query.user != 0 && req.query.till != 0) {
    transactionsDB.find(
      {
        $and: [
          { date: { $gte: startDate.toJSON(), $lte: endDate.toJSON() } },
          { status: parseInt(req.query.status) },
          { till: parseInt(req.query.till) },
          { user_id: parseInt(req.query.user) },
        ],
      },
      function (err, docs) {
        if (docs) res.send(docs);
      },
    );
  }
});

/**
 * POST endpoint: Create a new transaction.
 *
 * @param {Object} req request object with transaction data in the body.
 * @param {Object} res response object.
 * @returns {void}
 */
router.post("/new", function (req, res) {
  let newTransaction = req.body;

  if (!newTransaction.items || !Array.isArray(newTransaction.items) || newTransaction.items.length === 0) {
    return res.status(400).send("No items in transaction");
  }

  let requiresPrescription = false;

  // Process line items asynchronously to validate against DB
  async.eachSeries(newTransaction.items, function(item, callback) {
    inventoryDB.findOne({ _id: parseInt(item.id) }, function(err, product) {
      if (err || !product) {
        return callback(new Error(`Product ID ${item.id} not found`));
      }
      
      // Override client-provided values with canonical DB values
      item.price = parseFloat(product.price || 0);
      item.gst = parseFloat(product.gst || 0);
      item.scheduleType = product.scheduleType || "";

      let itemTotal = item.quantity * item.price;
      let gstAmount = (itemTotal * item.gst) / 100;
      
      item.taxableAmount = itemTotal;
      item.cgst = gstAmount / 2;
      item.sgst = gstAmount / 2;

      // Check against standard schedule strings
      if (item.scheduleType === 'H' || item.scheduleType === 'H1' || 
          item.scheduleType === 'Schedule H' || item.scheduleType === 'Schedule H1') {
        requiresPrescription = true;
      }
      callback();
    });
  }, function(err) {
    if (err) {
      return res.status(400).json({ error: "Bad Request", message: err.message });
    }

    if (requiresPrescription) {
      if (!newTransaction.prescriptionRecord || !newTransaction.prescriptionRecord.patientName || !newTransaction.prescriptionRecord.prescriberName) {
        return res.status(400).json({
          error: "Bad Request",
          message: "Prescription record (patientName, prescriberName, prescriberRegNo, date) is required for Schedule H/H1 drugs."
        });
      }
    }

    transactionsDB.insert(newTransaction, function (insertErr, transaction) {
      if (insertErr) {
        console.error(insertErr);
        res.status(500).json({
          error: "Internal Server Error",
          message: "An unexpected error occurred.",
        });
      } else {
        res.sendStatus(200);

        let isPaid = parseInt(newTransaction.status) === 1 || 
                     (newTransaction.paid && parseFloat(newTransaction.paid) >= parseFloat(newTransaction.total));
        if (isPaid) {
          Inventory.decrementInventory(newTransaction.items);
        }
      }
    });
  });
});

/**
 * PUT endpoint: Update an existing transaction.
 *
 * @param {Object} req request object with transaction data in the body.
 * @param {Object} res response object.
 * @returns {void}
 */
router.put("/new", function (req, res) {
  let oderId = req.body._id;
  transactionsDB.findOne({ _id: oderId }, function (findErr, existingTransaction) {
    if (findErr) {
      console.error(findErr);
      return res.status(500).json({
        error: "Internal Server Error",
        message: "An unexpected error occurred.",
      });
    }

    let wasPaid = false;
    if (existingTransaction) {
      wasPaid = parseInt(existingTransaction.status) === 1 || 
                (existingTransaction.paid && parseFloat(existingTransaction.paid) >= parseFloat(existingTransaction.total));
    }

    transactionsDB.update(
      {
        _id: oderId,
      },
      req.body,
      {},
      function (err, numReplaced, order) {
        if (err) {
          console.error(err);
          res.status(500).json({
            error: "Internal Server Error",
            message: "An unexpected error occurred.",
          });
        } else {
          res.sendStatus(200);

          let isPaid = parseInt(req.body.status) === 1 || 
                       (req.body.paid && parseFloat(req.body.paid) >= parseFloat(req.body.total));
                       
          if (isPaid && !wasPaid) {
            Inventory.decrementInventory(req.body.items);
          }
        }
      },
    );
  });
});

/**
 * POST endpoint: Delete a transaction.
 *
 * @param {Object} req request object with transaction data in the body.
 * @param {Object} res response object.
 * @returns {void}
 */
router.post("/delete", function (req, res) {
  let transaction = req.body;
  transactionsDB.remove(
    {
      _id: transaction.orderId,
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
 * GET endpoint: Get details of a specific transaction by transaction ID.
 *
 * @param {Object} req request object with transaction ID as a parameter.
 * @param {Object} res response object.
 * @returns {void}
 */
router.get("/:transactionId", function (req, res) {
  transactionsDB.find({ _id: parseInt(req.params.transactionId) }, function (err, doc) {
    if (doc) res.send(doc[0]);
  });
});

