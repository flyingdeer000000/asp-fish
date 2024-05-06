'use strict';
let _ = require('lodash')
let logger = require('quick-pomelo').logger.getLogger('connector', __filename);
let P = require('quick-pomelo').Promise;
let C = require('../../../../share/constant');

let Remote = function (app) {
    this.app = app;
};

Remote.prototype.kick = function (playerId, reason, cb) {
    if (_.isFunction(reason)) {
        cb = reason;
        reason = '';
    }

    //logger.info('kicking %s', playerId, ' reason ', reason);

    //TODO: unbind instead of kick
    if (!_.isArray(playerId)) {
        playerId = [playerId]
    }

    let allP = [];
    let users = [];
    let sessionService = this.app.get('sessionService');
    playerId.forEach((value, index, arr) => {
        // this.app.get('sessionService').kick(value,reason || 'kick', cb);
        let session = sessionService.getByUid(value);
        if (!!session && session.length > 0) {
            users.push(value)
            allP.push(P.promisify(sessionService.kick, sessionService)(value, reason || 'kick'));
        }

    })

    P.all(allP)
        .then(() => {
            return users;
        })
        .nodeify(cb);

};

Remote.prototype._logout = P.coroutine(function* (playerId, gameId, sessionData, reason) {
    try {
        if (!playerId) {
            return;
        }

        let controller = this.app.controllers.account;
        let data = null;
        let rpc = controller.getRemoteLoginSvr(gameId);

        let sessionService = this.app.get('sessionService');
        let session = sessionService.getByUid(playerId);

        if (rpc) {
            data = yield P.promisify(rpc.logout, rpc)(playerId, playerId, sessionData, reason, session);
        }

        return data;
    } catch (err) {
        logger.error('[accountRemote][_logout] playerId: %s, gameId: %s, err: ', playerId, gameId, err);
    }
});

Remote.prototype.kickSync = function (playerId, gameId, reason, cb) {
    let self = this;
    let sessionService = this.app.get('sessionService');
    let session;
    P.resolve(0)
        .then(() => {
            session = sessionService.getByUid(playerId);

            if (!!session && session.length > 0 && !!playerId) {
                let s = session[0];

                return P.promisify(sessionService.kick, sessionService)(playerId, 'kickSync_' + reason)
                    .then(() => {
                        return s;
                    })
            } else {
                return null;
            }
        })
        .then((p_session) => {
            session = p_session;
            if (!!playerId && !!gameId && !!session) {
                let sessionData = {
                    accessToken: session.get('accessToken'),
                    fireServerId: session.get('fireServer'),
                    roundID: session.get('roundID'),
                    os: session.get('os'),
                    osVersion: session.get('osVersion'),
                    browser: session.get('browser'),
                    browserVersion: session.get('browserVersion'),
                    betSetting: session.get('betSetting'),
                    domainSetting: session.get('domainSetting'),
                };
                return self._logout(playerId, gameId, sessionData, reason);
            } else {
                return {error: C.PLAYER_NOT_LOGIN};
            }
        })
        .then(P.coroutine(function* (data) {
            if (!data || data.error !== C.OK) {
                let rpc = self.app.controllers.account.getRemoteLoginSvr(gameId);
                // 踢人失敗，至少要清除 online player cache, 不管清不清的掉, 都執行
                yield P.promisify(rpc.clearPlayer, rpc)(playerId, playerId);
                reason = `connector.accountRemote.kickSync => Not Done ! reason: ${reason}`;
            } else {
                reason = 'connector.accountRemote.kickSync => Done: ' + reason;
            }
            self.app.controllers.debug.info('info', 'kickSync', {
                playerId, gameId, session: !!session,
                data: data,
                reason: reason,
            });
            return data;
        }))
        .catch(err => {
            logger.error('[accountRemote][kickSync] playerId: %s, err : ', playerId, err);
        })
        .nodeify(cb);

};

Remote.prototype.getOnlinePlayers = function (cb) {
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

// 取得線上玩家人數列表
// 回傳 (gameId -> (dc -> (agentId -> [playerId])))
Remote.prototype.getOnlinePlayerNums = function (cb) {
    let sessionService = this.app.get('sessionService');
    let nums = {};

    try {
        sessionService.forEachBindedSession(function (session) {
            if (session.uid) {
                let gameId = session.get('gameId');
                let dc = session.get('dc');
                let agentId = session.get('agentId');
                if (gameId && dc && agentId) {
                    nums[gameId] = nums[gameId] || {};
                    nums[gameId][dc] = nums[gameId][dc] || {};
                    nums[gameId][dc][agentId] = nums[gameId][dc][agentId] || [];
                    nums[gameId][dc][agentId].push(session.uid);
                }
            }
        });
    } catch (err) {
        logger.warn('[accountRemote][getOnlinePlayerNums] err: ', err);
    }

    cb(null, nums);
}

Remote.prototype.getPlayerSessionId = function (playerId, cb) {
    try {
        let sessionService = this.app.get('sessionService');
        let session = sessionService.getByUid(playerId);
        cb(null, !!session ? session[0].id : null);
    } catch (err) {
        logger.warn(`[accountRemote][getPlayerSessionId] serverId: ${this.app.getServerId()} err: `, err);
        cb(null, null);
    }
}

module.exports = function (app) {
    return new Remote(app);
};
