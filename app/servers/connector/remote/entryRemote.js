'use strict';

let logger = require('quick-pomelo').logger.getLogger('connector', __filename);
let P = require('quick-pomelo').Promise;
let util = require('util');

let Remote = function (app) {
    this.app = app;
};

module.exports = function (app) {
    return new Remote(app);
};

Remote.prototype.kick = function (playerId, cb) {
    try {
        logger.warn('kicking %s', playerId);

        let sessionService = this.app.get('sessionService');

        return P.promisify(sessionService.kick, sessionService)(playerId)
            .nodeify(cb);
    } catch (err) {
        logger.error('[entryRemote][kick] playerId: %s, err : ', playerId, err);
    }
};

Remote.prototype.getUids = function (playerId, cb) {
    let sessionService = this.app.get('sessionService');
    let playerIds = [];
    if (!!sessionService) {
        sessionService.forEachBindedSession(function (session) {
            if (!!session.uid) {
                playerIds.push(session.uid);
            }
        });
    }
    cb(null, playerIds);
};

