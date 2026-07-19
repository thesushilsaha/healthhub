const utils = require("./utils");

/** CheckOut Functions **/
$(document).ready(function () {
  /**
   * handle keypad button pressed.
   * @param {string} value - The keypad value to be processed.
   * @param {boolean} isDueInput - Indicates whether the input is for due payment.
   */
  $.fn.keypadBtnPressed = function (value, isDueInput) {
    let paymentAmount = $("#payment").val();
    if (isDueInput) {
      $("#refNumber").val($("#refNumber").val() + "" + value);
    } else {
      paymentAmount = paymentAmount + "" + value;
      $("#paymentText").val(utils.moneyFormat(paymentAmount));
      $("#payment").val(paymentAmount);
      $(this).calculateChange();
    }
  };

  /**
   * Format payment amount with commas when a point is pressed
   */
  $.fn.digits = function () {
    let paymentAmount = $("#payment").val();
    $("#paymentText").val(utils.moneyFormat(paymentAmount));
    $("#payment").val(paymentAmount + ".");
    $(this).calculateChange();
  };

  /**
   * Calculate and display the balance due.
   */
  $.fn.calculateChange = function () {
    var payablePriceStr = ($("#payablePrice").val() || "").replace(/,/g, "");
    var paymentStr = ($("#payment").val() || "").replace(/,/g, "");
    var payablePrice = parseFloat(payablePriceStr) || 0;
    var payment = parseFloat(paymentStr) || 0;
    var change = payablePrice - payment;

    // Always keep confirmPayment visible, enable as soon as at least 1 digit (>0) is entered
    $("#confirmPayment").show();
    if (paymentStr.trim().length > 0 && !isNaN(payment) && payment > 0) {
      $("#confirmPayment").prop("disabled", false);
    } else {
      $("#confirmPayment").prop("disabled", true);
    }

    if (change <= 0) {
      $("#change").text(utils.moneyFormat(Math.abs(change.toFixed(2))));
    } else {
      $("#change").text("0");
    }
  };

  // Support direct physical keyboard input on paymentText
  $(document).on("input keyup change", "#paymentText", function () {
    let rawVal = $(this).val().replace(/[^0-9.]/g, "");
    $("#payment").val(rawVal);
    $(this).calculateChange();
  });

  var $keypadBtn = $(".keypad-btn").on("click", function () {
    const key = $(this).data("val");
    const isdue = $(this).data("isdue");
    switch(key)
    {
    case "del" : { 
      if(isdue)
      {
        $('#refNumber').val((i, val) => val.slice(0, -1));
      }
      else
      {
        $("#payment").val((i, val) => val.slice(0, -1));
      //re-format displayed amount after deletion 
      $("#paymentText").val((i, val) => utils.moneyFormat($("#payment").val()));
      }
      $(this).calculateChange()
    }; break;

    case "ac":{
      if(isdue)
      {
          $('#refNumber').val('');
      }
      else
      {
        $('#payment,#paymentText').val('');
        $(this).calculateChange();
      }
       
    };break;

  case "point": {
    $(this).digits()
    };break;

   default: $(this).keypadBtnPressed(key, isdue); break;
  }
});

  /** Switch Views for Payment Options **/
  var $list = $(".list-group-item").on("click", function () {
    $list.removeClass("active");
    $(this).addClass("active");
    if (this.id == "check") {
      $("#cardInfo").show();
      $("#cardInfo .input-group-addon").text("Check Info");
    } else if (this.id == "card") {
      $("#cardInfo").show();
      $("#cardInfo .input-group-addon").text("Card Info");
    } else if (this.id == "cash") {
      $("#cardInfo").hide();
    }
  });
});