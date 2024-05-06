'use strict';
let _ = require('lodash');
let quick = require('quick-pomelo');
let P = quick.Promise;
let logger = quick.logger.getLogger('connector', __filename);
let C = require('../../share/constant');
const apiCode = require('../expressRouter/apiServerStatus');
// let wxApi = require('../wxUtils/wxApi');
const uuid = require('uuid/v1');
let utils = require('../utils/utils');
let consts = require('../../share/consts')
const minAccountLength = 6;
const maxAccountLength = 20;

let Controller = function (app) {
    this.app = app;
    this.webConnectorCls = this.app.get('WebConnectorCls');
};

module.exports = function (app) {
    return new Controller(app);
};


let proto = Controller.prototype;
let cort = P.coroutine;

proto.getRemoteLoginSvr = function (gameId) {
    try {
        let config = this.app.controllers.fishHunterConfig.getFishServerConfig();
        config = config.fishGameId;

        if (config.indexOf(gameId) < 0) {
            return null;
        } else {
            return this.app.rpc.fishHunter.playerRemote;
        }
    } catch (err) {
        logger.error('[account][getRemoteLoginSvr] err: ', err);
        // newly add
        throw err;
    }
}

//從mysql中異動玩家額度
proto.modifyCreditByPlayerIdAsync = cort(function* (player, amount, creditCode, reason, isFreeze, allOut, logQuotaId) {
    try {
        let self = this;

        //等待API Server回傳結果驗證
        let config = self.app.controllers.fishHunterConfig.getFishServerConfig();
        let url = config.webConnectorUrl;
        let opts = {
            method: consts.GSBridgeMethod.modifyCustomerCreditAsync,
            platform: consts.APIServerPlatform.gsBridge,
            id: player._id,
            gameId: player.gameId,  // 未來風控用
            amount: amount,
            creditCode: creditCode,
            reason: reason,
            allOut: allOut,
            logQuotaId: logQuotaId || 0,
        };
        if (isFreeze) opts['isFreeze'] = isFreeze;
        if (typeof player.roundID !== 'undefined' && player.roundID !== '' && player.roundID !== 0) opts['roundID'] = player.roundID;
        if (typeof player.ratio !== 'undefined' && player.ratio !== '' && player.ratio !== 0) opts['ratio'] = player.ratio;
        if (typeof player.loginIp !== 'undefined' && player.loginIp !== '') opts['IP'] = player.loginIp;

        logger.info('[account][modifyCreditByPlayerIdAsync][CallAPI] modifyCustomerCreditAsync ：', opts);
        let apiData = yield utils.httpPost(url, opts);
        if (!!apiData && apiData.status === apiCode.SUCCESS) {
            if (!!apiData.data && apiData.data.hasOwnProperty('status')) {
                // api 失敗
                switch (apiData.data.status) {
                    case apiCode.PLAYER_OUT_GOLD:
                        logger.warn('[account][modifyCreditByPlayerIdAsync][RES] playerId: %s, modifyCustomerCreditAsync ：', player._id, JSON.stringify(apiData));
                        break;
                    default:
                        logger.error('[account][modifyCreditByPlayerIdAsync][RES] playerId: %s, modifyCustomerCreditAsync FAIL 1 ：', player._id, JSON.stringify(apiData));
                        break;
                }
                return {error: C.PLAYER_OUT_GOLD};
            }
            // api 成功
            logger.info('[account][modifyCreditByPlayerIdAsync][RES] playerId: %s, modifyCustomerCreditAsync : ', player._id, JSON.stringify(apiData));
            return {error: null, data: apiData.data.r_data};
        } else {
            logger.error('[account][modifyCreditByPlayerIdAsync][RES] playerId: %s, modifyCustomerCreditAsync FAIL 2 ：', player._id, JSON.stringify(apiData));
            return {error: C.PLAYER_NOT_FOUND};
        }

    } catch (err) {
        logger.error(
            '[account][modifyCreditByPlayerIdAsync] playerId: %s, amount: %s, creditCode: %s, reason: %s, err: ',
            player._id, amount, creditCode, reason, err
        );
    }
});

// proto.findChildrenByParentId = cort(function*(pId, filters) {
//   let self = this;
//   let app = self.app;
//   let pIds = [];
//
//   if (!!pId) {
//     pIds = yield app.models.Account.findReadOnlyAsync({parentId: pId});
//
//     if (!!filters && !!filters.productId) {
//       let result = [];
//
//       pIds = yield P.filter(pIds, (value) => {
//         return app.memdb.goose.transactionAsync(function () {
//           return app.controllers.agent.hasUserProductAsync(value.twSSOId, filters.productId)
//         }, app.getServerId())
//         .then((data) => {
//           if (data == 1) {
//             return true;
//           }
//           else {
//             return false;
//           }
//         })
//         .catch((err) => {
//           logger.error('findChildrenByParentId error ', err);
//           return false;
//         });
//       })
//     }
//
//     return {error: null, data: pIds};
//   }
//   else {
//     return {error: C.ERROR};
//   }
// });

// proto.findChildCountByParentId = cort(function*(pId) {
//   let self = this;
//   let app = self.app;
//
//   if (!!pId) {
//     let cnt = yield app.models.Account.countAsync({parentId: pId});
//
//     return cnt;
//   }
//   else {
//     return 0
//   }
// });

// 異動MySQL玩家帳號狀態
proto.modifyCustomerStateByCid = cort(function* (player, state, reason) {
    try {
        let data = {
            playerId: player._id,
            userName: player.userName,
            serverId: this.app.getServerId(),
            gameId: player.gameId,
            reason: reason,
            beforeState: player.accountState,
            afterState: state,
        };
        //等待API Server回傳結果驗證
        let config = this.app.controllers.fishHunterConfig.getFishServerConfig();
        let url = config.webConnectorUrl;
        let opts = {
            method: consts.GSBridgeMethod.modifyCustomerStateAsync,
            platform: consts.APIServerPlatform.gsBridge,
            data: data,
        };
        logger.info('[account][modifyCustomerStateByCid][CallAPI] modifyCustomerStateAsync ：', opts);
        let apiData = yield utils.httpPost(url, opts);
        if (!!apiData && apiData.status === apiCode.SUCCESS) {
            logger.info('[account][modifyCustomerStateByCid][RES] playerId: %s, modifyCustomerStateAsync : ', player._id, JSON.stringify(apiData));
            return {error: null, data: apiData.data.r_data};
        } else {
            logger.error('[account][modifyCustomerStateByCid][RES] playerId: %s, modifyCustomerStateAsync FAIL ：', player._id, JSON.stringify(apiData));
            return {error: apiData.status};
        }
    } catch (err) {
        logger.error('[account][modifyCustomerStateByCid] playerId: %s, err: ', player._id, err);
    }
});
