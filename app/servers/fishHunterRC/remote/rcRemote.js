let quick = require('quick-pomelo');
let P = quick.Promise;
let logger = quick.logger.getLogger('connector', __filename);
let C = require('../../../../share/constant');


let Remote = function (app) {
    this.app = app;
};

module.exports = function (app) {
    return new Remote(app);
};

let proto = Remote.prototype;
let cort = P.coroutine;

proto.addRecord = function (creditCode, gameId, serverId, room, amount, event, dc, exchangeRate, cb) {
    let self = this;

    self.app.controllers.fishHunterRC.cache(creditCode, gameId, serverId, room, amount, event, dc, exchangeRate);
    cb(null, {});
};
