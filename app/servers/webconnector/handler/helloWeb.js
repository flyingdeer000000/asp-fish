var quick = require('quick-pomelo');
var logger = quick.logger.getLogger('connector', __filename);
var C = require('../../../../share/constant');

var Handler = function (app) {
    this.app = app;
};

module.exports = function (app) {
    return new Handler(app);
};

var proto = Handler.prototype;

// proto.sayHello = function (msg,session,next) {
//     logger.info("sayHello ",msg);
//
//     next(null,{code:C.OK,data:'hello client',echo:msg});
// }
