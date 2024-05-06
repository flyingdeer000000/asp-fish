let _ = require('lodash');
let quick = require('quick-pomelo');
let P = quick.Promise;
let logger = quick.logger.getLogger('connector', __filename);
let C = require('../../../../share/constant');
let consts = require('../../../../share/consts');


let Cron = function (app) {
    this.startupTime = Date.now();
    this.app = app;
};

module.exports = function (app) {
    return new Cron(app);
};

let proto = Cron.prototype;
let cort = P.coroutine;

// proto.getSessionsFromFrontend = function () {
//   // 10s 后开始执行
//   if(Date.now() - this.startupTime < 10000){
//     return;
//   }
//
//   let backendSessionService = this.app.get('backendSessionService');
//   let connectors = this.app.getServersByType('connector');
//   let sessions = [];
//
//   //通过 sid 遍历每个connector上的前10个session
//   P.each(connectors,(connector) => {
//     let results = [];
//     for(let i=0; i<10; i++){
//
//       (function (sid) {
//         let res = new P(resolve => {
//           backendSessionService.get(connector.id,sid,function(err,ss){
//             if(!err && !!ss) {
//               let session = Array.isArray(ss) ? ss[0] : ss;
//
//               resolve(session);
//             }
//             else{
//               resolve(null);
//             }
//           })
//         });
//
//         results.push(res);
//       })(i)
//     }
//
//     return P.all(results)
//     .then(data => {
//       data = data.map(value => {
//         return !value ? null : {sid:value.id,uid:value.uid,connId:value.frontendId};
//       });
//
//       return data;
//     })
//     .then(data => {
//       data = data.filter(value => {return !!value });
//       sessions = sessions.concat(data);
//
//       return sessions;
//     })
//   })
//   .then(() => {
//     logger.warn('getSessionsBySid  ',sessions);
//     return sessions;
//   })
//   .then(data => {
//     //将通过 sid 收集的session数据作为玩家数据，测试getByUid接口
//     //实际玩家数据可能来源于数据库或其他地方
//     return this.getSessionsFromFrontendByUid(data);
//   })
// }
//
// proto.getSessionsFromFrontendByUid = function (players) {
//
//   if(!players || players.length ==0){
//     return;
//   }
//
//   let backendSessionService = this.app.get('backendSessionService');
//   let sessions = [];
//
//   //通过 sid 遍历每个connector上的前10个session
//   return P.each(players,(player) => {
//     let results = [];
//     let res = new P(resolve => {
//       backendSessionService.getByUid(player.connId,player.uid,function(err,ss){
//         if(!err && !!ss) {
//           let session = Array.isArray(ss) ? ss[0] : ss;
//
//           resolve(session);
//         }
//         else{
//           resolve(null);
//         }
//       })
//     });
//
//     results.push(res);
//
//     return P.all(results)
//     .then(data => {
//       data = data.map(value => {
//         return !value ? null : {sid:value.id,uid:value.uid,connId:value.frontendId};
//       });
//
//       return data;
//     })
//     .then(data => {
//       data = data.filter(value => {return !!value });
//       sessions = sessions.concat(data);
//
//       return sessions;
//     })
//   })
//   .then(() => {
//     logger.warn('getSessionsByUid  ',sessions);
//     return sessions;
//   })
// }
