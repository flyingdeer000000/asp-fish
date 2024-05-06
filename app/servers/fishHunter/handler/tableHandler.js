let _ = require('lodash');
let quick = require('quick-pomelo');
let P = quick.Promise;
let logger = quick.logger.getLogger('connector', __filename);
let C = require('../../../../share/constant');
let consts = require('../../../../share/consts');
const {Ret} = require("../../../utils/format-util");
const Mona = require("../../../dao/mona");

const TableHandler = function (app) {
    this.app = app;
    this.mona = new Mona({
        shardId: app.getServerId()
    });
};

module.exports = function (app) {
    return new TableHandler(app);
};

let proto = TableHandler.prototype;
let cort = P.coroutine

proto.searchTableAndJoin = async function (msg, session, next) {
    // const ret = {};
    try {
        this.app.controllers.debug.client(msg, session);
        const playerId = session.uid;
        if (!playerId) {
            return Ret.error(next, "session not found: " + playerId);
        }

        const params = msg.query || msg.body || {};
        const demoMode = session.get("demoMode");
        const gameId = session.get("gameId");

        const player = await this.mona.get({
            schema: this.app.models['FishHunterPlayer'],
            id: playerId,
        });

        if (!!player.tableId || !!player.areaId || player.gameState !== consts.GameState.FREE) {

            // return next(null, {code: C.TABLE_HAS_ALREADY});
            return Ret.error(next, "Table Already Exists", null, C.TABLE_HAS_ALREADY);
        }

        const roomConfig =
            this.app.controllers.fishHunterConfig.getRoomConfig(gameId);
        const roomConfigList = Object.keys(roomConfig.room);
        // 玩家傳的tableLevel不存在於設定檔時，讓玩家隨機入廳
        if (roomConfigList.indexOf(params.level) < 0) {
            params.level = roomConfigList[_.random(0, roomConfigList.length - 1)];
        }

        const betSetting = session.get('betSetting');
        if (betSetting && betSetting.usedCid) {
            params.betSettingUsedCid = betSetting.usedCid;
        } else {
            throw new Error("betSetting.userCid not found");
        }

        const retJoin = await this.app.controllers.sitDown.searchAndJoinTable(player, params);
        if (!retJoin || retJoin.error) {
            throw new Error("sitDown.searchAndJoinTable failure: " + retJoin ? retJoin.error : "no response");
        }
        const ret = retJoin.data;
        /*
        const ret = {
          table: {
            playerIds: [ playerId ]
          },
          session: {
            id: session.id,
            uid: session.uid,
            demoMode: demoMode,
          }
        }
         */
        Ret.data(next, ret);
    } catch (ex) {
        Ret.error(next, ex.message, ex);
    }

}


proto.leaveTable = cort(function* (msg, session, next) {
    this.app.controllers.debug.client(msg, session);
    if (!session.uid) {
        return next(null, {code: C.ILLEGAL});
    }

    try {
        let playerId = session.uid;
        let playerControl = this.app.controllers.fishHunterPlayer;
        let player = yield playerControl.findOneAsync(playerId);
        if (!player) return next(null, {code: C.PLAYER_NOT_FOUND});

        // 檢查玩家 session
        let sessionId = yield this.app.controllers.fishHunterPlayer.getPlayerSessionId(player, 'leaveTable');
        if (!sessionId) return next(null, {code: C.ERROR});

        // 檢查非法狀態操作
        if (!this.app.controllers.playerGameStateDef.check(player, consts.route.client.clientAction.leaveTable))
            return next(null, {code: C.ERROR});

        let betSetting = session.get('betSetting');
        yield this.app.controllers.standUp.leaveTableAsync(player, betSetting.usedCid);
        next(null, {code: C.OK});
    } catch (err) {
        logger.error('leaveTable error ', err);
        next(null, {code: C.ERROR});
    }
});

// TODO legacy code? legacy API?
proto.updateScene = cort(function* (msg, session, next) {
    try {
        this.app.controllers.debug.client(msg, session);
        if (!session.uid) return next(null, {code: C.ILLEGAL});
        let playerId = session.uid;
        let player = yield this.app.controllers.fishHunterPlayer.findReadOnlyAsync(playerId);
        if (!player) {
            throw new Error("PLAYER_NOT_FOUND");
        }

        // 檢查玩家 session
        let sessionId = yield this.app.controllers.fishHunterPlayer.getPlayerSessionId(player, 'updateScene');
        if (!sessionId) {
            throw new Error("session id not found");
        }

        if (!player.gameId || !player.connectorId) { // 檢查玩家是否為正常步驟登入
            throw new Error("PLAYER_NOT_LOGIN");
        }

        // the code is not right at all, there is no fishHunterGame.updateScene() in the original code
        // there is no correspondening code in front-end, maybe these are legacy codes
        // let ret = yield this.app.controllers.fishHunterGame.updateScene(player);
        let areaId = playerId.areaId;
        let ret = yield this.app.controllers.sitDown.updateScene(playerId, areaId);

        if (ret.error) {
            return Ret.error(next, null, null, ret.error);
        }

        Ret.data(next, ret.data);

    } catch (err) {
        logger.error('updateScene error ', err);
        Ret.error(next, "", err);
    }
});
