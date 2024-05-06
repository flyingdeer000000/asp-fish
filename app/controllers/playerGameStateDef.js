'use strict';
let quick = require('quick-pomelo');
let consts = require('../../share/consts');
let logger = quick.logger.getLogger('connector', __filename);
let C = require('../../share/constant');

let Controller = function (app) {
    this.app = app;
};

module.exports = function (app) {
    return new Controller(app);
};

let proto = Controller.prototype;

proto.check = function (player, action) {
    try {
        let self = this;
        let res = false;
        if (!self.detectState(player, action))
            // self.app.controllers.fishHunterPlayer.kickPlayer(player.connectorId, player._id, player.gameId, player.loginIp, player.updateTime, consts.KickUserReason.PlayerStateDoesNotSupportEvent);
            self.app.controllers.fishHunterPlayer.kickPlayer(player.connectorId, player._id, player.gameId, player.loginIp, player.updateTime, C.PLAYER_STATE_NOT_SUSPEND_EVENT);
        else
            res = true;
        return res;
    } catch (err) {
        logger.error('[playerGameStateDef][check] playerId: %s, err: ', player._id, err);
    }
}

proto.detectState = function (player, action) {
    try {
        let res = false;
        switch (player.gameState) {
            case consts.GameState.FREE:
                switch (action) {
                    case consts.route.client.clientAction.twLogin:
                    case consts.route.client.clientAction.onWalletAndAccountInfo:
                    case consts.route.client.clientAction.onCurrencyExchange:
                    case consts.route.client.clientAction.searchTable:
                    case consts.route.client.clientAction.sitDown:
                    case consts.route.client.clientAction.leaveTable:
                        res = true;
                        break;
                    default:
                        logger.warn('[playerGameStateDef][detectState] fail by player: %s, GameId: %s, currentGameStste: %s, action: %s ', player._id, player.gameId, player.gameState, action);
                        break;
                }
                break;
            case consts.GameState.READY:
                throw ('fail by player: ' + player._id + ', GameId: ' + player.gameId + ', currentGameStste: ' + player.gameState + ', action: ' + action);
            case consts.GameState.PLAYING:
                switch (action) {
                    case consts.route.client.clientAction.onWalletAndAccountInfo:
                    case consts.route.client.clientAction.onCurrencyExchange:
                    case consts.route.client.clientAction.onUpdateCannon:
                    case consts.route.client.clientAction.onUpdatePosition:
                    case consts.route.client.clientAction.onFire:
                    case consts.route.client.clientAction.onCollider:
                    case consts.route.client.clientAction.getTime:
                    case consts.route.client.clientAction.onPushChatMsg:
                    case consts.route.client.clientAction.quitGame:

                    case consts.route.client.clientAction.demoshow:
                    case consts.route.client.clientAction.killfirst:
                    case consts.route.client.clientAction.noDiefirst:
                    case consts.route.client.clientAction.transition:
                        res = true;
                        break;
                    default:
                        logger.warn('[playerGameStateDef][detectState] fail by player: %s, GameId: %s, currentGameStste: %s, action: %s ', player._id, player.gameId, player.gameState, action);
                        break;
                }
                break;
            case consts.GameState.LEAVING:
                logger.warn('[playerGameStateDef][detectState] fail by player: %s, GameId: %s, currentGameStste: %s, action: %s ', player._id, player.gameId, player.gameState, action);
                break;
        }
        return res;
    } catch (err) {
        logger.error('[playerGameStateDef][detectState] err: ', err);
        return false;
    }
}
