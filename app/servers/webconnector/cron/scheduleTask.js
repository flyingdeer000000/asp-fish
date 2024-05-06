var _ = require('lodash');
var quick = require('quick-pomelo');
var P = quick.Promise;
var logger = quick.logger.getLogger('dev', __filename);
var C = require('../../../../share/constant');
var consts = require('../../../../share/consts');
// var cheerio = require('cheerio');
var request = require('request');

const targetUrl = 'http://www.boc.cn/sourcedb/whpj/index.html';

var Cron = function (app) {
    this.startupTime = Date.now();
    this.app = app;
};

module.exports = function (app) {
    return new Cron(app);
};

var proto = Cron.prototype;
var cort = P.coroutine;

// var rateApi = function (cb) {
//   request.get(
//       {
//         url: targetUrl
//       },
//       function (error, response, body) {
//         if(!body){
//           return;
//         }
//         var $ = cheerio.load(body, {decodeEntities: false});//防止中文乱码
//
//         var data = [];
//         $('body').find('td').each(function (index, ele) {
//           var str = $(ele).html().trim();
//           data.push(str);
//         });
//
//         var res = {};
//
//         var currency = ['美元', '泰国铢', '韩国元', '日元', '林吉特'];
//         var creditCode = {
//           "美元": "USD",
//           "泰国铢": "THB",
//           "韩国元": "KRW",
//           "日元": "JPY",
//           "林吉特": "MYR"
//         };
//         for (var i = 0; i < data.length; i++) {
//           if (currency.indexOf(data[i]) != -1) {
//             var code = creditCode[data[i]];
//             var dateStr = data[i + 6].split('-');
//             var timeStr = data[i + 7].split(':');
//             res[code] = {
//               rate: (data[i + 1] / 100).toFixed(4),
//               time: {
//                 year : parseInt(dateStr[0]),
//                 month: parseInt(dateStr[1])-1,
//                 day:parseInt(dateStr[2]),
//                 hour:parseInt([timeStr[0]]),
//                 minute:parseInt([timeStr[1]]),
//                 second:parseInt([timeStr[2]]),
//               }
//             }
//           }
//         }
//
//         cb(res);
//       }
//   );
// }

// proto.exchangeRateScrapy = function () {
//   var self = this;
//   var controller = this.app.controllers.agent;
//
//   rateApi(function (res) {
//     var keys = Object.keys(res);
//     P.map(keys,(value) => {
//       return self.app.memdb.goose.transaction(function() {
//         var dt = res[value].time;
//         return controller.addExchangeRateAsync({
//           activateTime: new Date(dt.year,dt.month,dt.day,dt.hour,dt.minute,dt.second).getTime(),
//           rate: parseFloat(res[value].rate),
//           creditCode: value,
//           type: 'spot'
//         });
//
//       }, self.app.getServerId())
//       .then(() => {
//         self.app.event.emit('transactionSuccess')
//       })
//       .catch((err) => {
//         self.app.event.emit('transactionFail');
//         logger.error('exchangeRateScrapy reject ', err);
//       });
//     })
//
//   });
//
// };
