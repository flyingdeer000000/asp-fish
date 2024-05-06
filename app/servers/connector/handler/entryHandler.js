'use strict';

let quick = require('quick-pomelo');
let P = quick.Promise;
let _ = require('lodash');
let C = require('../../../../share/constant');
let md5 = require('md5');
let logger = quick.logger.getLogger('connector', __filename);
let Const = require('../../../../share/consts');
let NOTICE_TYPE = Const.NOTICE_TYPE;

let Handler = function (app) {
    this.app = app;
};

module.exports = function (app) {
    return new Handler(app);
};

let proto = Handler.prototype;

// RPC接口
// proto.getRemoteById = function (gameId) {
//     switch (gameId) {
//         case 10001:
//             return this.app.rpc.animal.animalRemote;
//         case 10002:
//             return this.app.rpc.golden.goldenRemote;
//         case 10003:
//             return this.app.rpc.niuniu.niuniuRemote;
//         case 10004:
//             return this.app.rpc.to.toRemote;
//         case 10005:
//             return this.app.rpc.pk.pkRemote;
//         case 10006:
//             return this.app.rpc.fruit.fruitRemote;
//         // 房间型
//         case 20001:
//             return this.app.rpc.ddz.ddzRemote;
//         case 20002:
//             return this.app.rpc.tw.twRemote;
//         case 20003:
//             return this.app.rpc.clown.clownRemote;
//         case 40001:
//             return this.app.rpc.acrossSea.acrossSeaRemote;
//     }
// };

// 登陆
// proto.login = P.coroutine(function* (msg, session, next) {
//     this.app.controllers.debug.client( msg, session );
//     if (session.uid) {
//         return next(null, { code: C.ERROR, msg: C.PLAYER_HAS_LOGGED });
//     }
//     if (!msg._id) {
//         return next(null, { code: C.ERROR, msg: C.PLAYER_MISSING_ID });
//     }
//     logger.info('begin login player ' + msg._id);
//
//     let playerId = msg._id;
//     let ip = session.__session__.__socket__.remoteAddress.ip;
//     let player = yield this.app.models.Player.findByIdReadOnlyAsync(playerId);
//     if (!player) {
//         player = yield this.app.controllers.player.createAsync(playerId, msg.name, msg.sex, msg.headurl, msg.spread, ip);
//     }
//     if (player.frozen) {
//         return next(null, { code: C.FAILD, msg: C.PLAYER_IS_FROZEN });
//     }
//     let isOneLogin = (function (lastLoginTime) {
//         let lastDate = new Date(lastLoginTime).getDate();
//         let nowDate = new Date().getDate();
//         return nowDate == lastDate ? '0' : '1';
//     })(player.lastLoginTime);
//     let self = this;
//     let nextExecAsync = P.coroutine(function* () {
//         let bindFail=false;
//         session.bind(playerId,function (e) {
//             if(!!e){
//                 logger.error(e);
//                 bindFail =true;
//             }
//
//         });
//
//         session.on('closed', function (session, reason) {
//             logger.info("player %s closed ",session.uid);
//
//             if (reason === 'kick' || !session.uid) {
//                 return;
//             }
//             let goose = self.app.memdb.goose;
//             goose.transaction(function () {
//                 return P.promisify(self.logout, self)({ closed: true }, session);
//             }, self.app.getServerId())
//                 .catch(function (e) {
//                     logger.error(e.stack);
//                 });
//         });
//         logger.info('player %s login', playerId);
//         let hallController = self.app.controllers.hall;
//         let nowTime = Date.now();
//         let weekCount = hallController.getWeekNumber();
//         let pls = player.signCount || [0, weekCount, Date.now()].join('|');
//         let ps = pls.split('|');
//         let hs = hallController.hasSign(nowTime, ps[2]);
//         let hasSign = false;
//         if (hs && Number(ps[0]) != 0) {
//             hasSign = true;
//         }
//         let task = yield self.app.models.Task.findByIdAsync(playerId);
//         if (task) {
//             let ever = _.filter(task.tasks, { get_type: 0 });
//             let trans = true;
//             if (ever) {
//                 for (let t of ever) {
//                     if (t && t.type == 2 && t.status == 2) {
//                         let es = hallController.hasSign(nowTime, t.get_time);
//                         if (es) trans = false;
//                     }
//                 }
//             }
//             if (!trans) {
//                 for (let ta of task.tasks) {
//                     if (ta && ta.type == 2 && ta.status == 1) {
//                         let esa = hallController.hasSign(nowTime, ta.get_time);
//                         if (esa) {
//                             trans = true; break;
//                         }
//                     }
//                 }
//             }
//             if (trans) {
//                 // yield hallController.pushMsgAsync([playerId], 'notice_message', { type: NOTICE_TYPE.task });
//             }
//         } else {
//             // yield hallController.pushMsgAsync([playerId], 'notice_message', { type: NOTICE_TYPE.task });
//         }
//         return next(null, {
//             code: C.OK,
//             data: {
//                 player: {
//                     account: player.account,
//                     name: player.name,
//                     sex: player.sex,
//                     gold: String(player.gold),
//                     vip: String(player.vip),
//                     quan: String(player.note),
//                     isOneLogin: isOneLogin,
//                     headurl: player.headurl,
//                     hasRecharge: !!(player.totalMoney || 0),
//                     sign: hasSign,
//                     taskstate: '0',
//                     emailstate: '0'
//                 }
//             }
//         });
//     });
//     let result = yield this.app.controllers.player.connectAsync(playerId, session.frontendId, ip);
//     if (result.oldGameSvrId) {
// 		let oldGameSvrId = result.oldGameSvrId;
// 		let gameRemote = this.getRemoteById(result.oldGameId);
// 		let oldGameSrv =this.app.getServerById(oldGameSvrId);
// 		if (gameRemote && oldGameSrv) {
//             logger.info('player leave ' + playerId + ' serverId ' + oldGameSvrId + ' gameId ' + result.oldGameId);
// 		    gameRemote.leaveGame.toServer(oldGameSvrId, playerId, () => { });
//         }
// 	}
//     if (result.oldConnectorId) {
//         let oldConnectorId = result.oldConnectorId;
//         let entryRemote = this.app.rpc.connector.entryRemote;
//         let oldConnectorSrv =this.app.getServerById(oldConnectorId);
//
//         if(entryRemote && oldConnectorSrv){
//             logger.info('player kick ' + playerId + ' connectorId ' + oldConnectorId + ' gameId ' + result.oldGameId);
//             yield P.promisify((cb) => entryRemote.kick({ frontendId: oldConnectorId }, playerId, (err, res) => cb(err, res)))();
//         }
//     }
//     return nextExecAsync();
// });

// 登出
// proto.logout = P.coroutine(function* (msg, session, next) {
//     this.app.controllers.debug.client( msg, session );
//     if (!session.uid) return next(null, { code: C.FAILD, msg: C.PLAYER_NOT_LOGIN });
//     let playerId = session.uid;
//     let result = yield this.app.controllers.player.disconnectAsync(playerId);
//     if (result.oldGameSvrId) {
//         let oldGameSvrId = result.oldGameSvrId;
//         let gameRemote = this.getRemoteById(result.oldGameId);
//         if (gameRemote) gameRemote.leaveGame.toServer(oldGameSvrId, playerId, () => { });
//     }
//
//     if (!msg.closed) {
//         yield P.promisify(session.unbind, session)(playerId);
//     }
//
//     logger.info('player %s logout', playerId);
//     return next(null, { code: C.OK });
// });

