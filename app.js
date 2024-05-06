// Copyright 2015 MemDB.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
// implied. See the License for the specific language governing
// permissions and limitations under the License. See the AUTHORS file
// for names of contributors.

'use strict';

/*
 * quick pomelo template project
 *
 * start memdb first by:
 * memdbcluster start -c ./config/memdb.conf.js
 */

const util = require('util');
const pomelo = require('pomelo');
const quick = require('quick-pomelo');
const pomeloConstants = require('pomelo/lib/util/constants');
const P = quick.Promise;
const logger = quick.logger.getLogger('pomelo', __filename);
// const pomeloLogger = require('pomelo-logger');
const webconnector = require('pomelo-webconnector');
const fs = require('fs')
// const tenpay = require('tenpay'); //weChat Pay npm module
const globalChannel = require('pomeloGlobalChannel');
const sync = require('pomelo-sync-plugin');
const configLoader = require('pomelo-config-loader');
// const mysql = require('./app/utils/mysql/mysql');

require('events').EventEmitter.defaultMaxListeners = 0;

//const easyMonitor = require('easy-monitor');

const app = pomelo.createApp();
app.set('name', 'JiaYuGame');

app.set('WebConnectorCls', webconnector.webconnector);

// not working!
app.set('errorHandler', function (err, msg, resp, session, cb) {
  resp = {
    code: 500,
    stack: err.stack,
    message: err.message,
    from: 'default.error.handler',
  };
  // console.log("so ? ", resp);
  cb(err, resp);
});

// configure for global
app.configure('all', function () {
//    easyMonitor(app.getServerId());

  app.enable('systemMonitor');
  app.enable('rpcDebugLog');
  app.set('proxyConfig', {
    bufferMsg: true,
    interval: 30,
    lazyConnection: true,
    timeout: 15 * 1000,
    failMode: 'failfast',
  });

  app.set('remoteConfig', {
    bufferMsg: true,
    interval: 30,
  });

  app.set('serverConfig', {
    reloadHandlers: true,
    reloadRemotes: true,
  });

  webconnector.webconnector.privateKey = fs.readFileSync('./config/jwt/private.pem');
  webconnector.webconnector.publicKey = fs.readFileSync('./config/jwt/public.pem');


  // const onlineUser = require('./app/modules/onlineUser');
  // if (typeof app.registerAdmin === 'function') {
  //   //app.registerAdmin(sceneInfo, {app: app});
  //   app.registerAdmin(onlineUser, {app: app});
  // }

  // Configure memdb
  app.loadConfigBaseApp('memdbConfig', 'memdb.json');

  // Load components
  app.load(quick.components.memdb);
  app.load(quick.components.controllers);
  app.load(quick.components.routes);
  app.load(quick.components.timer);

  app.load(require('./app/components/tableSearcher'));

  // Configure logger
  const loggerConfig = app.getBase() + '/config/log4js.json';
  const loggerOpts = {
    serverId: app.getServerId(),
    base: app.getBase(),
  };
  quick.logger.configure(loggerConfig, loggerOpts);

  // Configure filter
  if (app.getServerType() != 'gate') {
    app.filter(quick.filters.transaction(app));
    app.rpcFilter(pomelo.rpcFilters.rpcLog());
    // app.rpcFilter(pomelo.rpcFilters.toobusy());
  }
  // app.globalFilter(quick.filters.reqId(app));

  // Add beforeStop hook
  app.lifecycleCbs[pomeloConstants.LIFECYCLE.BEFORE_SHUTDOWN] = function (app, shutdown, cancelShutDownTimer) {
    cancelShutDownTimer();

    if (app.getServerType() === 'master') {

      // Wait for all server stop
      const tryShutdown = function () {
        if (Object.keys(app.getServers()).length === 0) {
          quick.logger.shutdown(shutdown);
        }
        else {
          setTimeout(tryShutdown, 200);
        }
      };
      tryShutdown();
      return;
    }
    quick.logger.shutdown(shutdown);
  };



  // app.loadConfigBaseApp("roomConfig", "/statics/config/room.json", true);
  // app.loadConfigBaseApp("fishHunterConfig", "/statics/config/fishHunter.json", true);
  // app.loadConfigBaseApp("fishGroupConfig", "/statics/config/fishGroup.json", true);
  // app.loadConfigBaseApp("fishPathsConfig", "/statics/config/path.json", true);
  // app.loadConfigBaseApp("fishFlockConfig", "/statics/config/fishFlock.json", true);
  // app.loadConfigBaseApp("serverCnf", "/statics/config/serverCnf.json", true);

  // app.loadConfigBaseApp("apiServerConfig", "/statics/config/apiServer.json", true);
/*
  const config = {
    appid: '1111111111111111',
    mchid: '11111111111111111',
    partnerKey: '1111111111111111111111111111',
    pfx: null,//require('fs').readFileSync('./statics/apiclient_cert.p12'),
    notify_url: 'http://www.jiayuwangluo.cn:8090/api/wxPayNotice',
    spbill_create_ip: '127.0.0.1'
  };
// 方式一
  const api = new tenpay(config);
  app.set('tenpay', api);
*/
  const globalPush = require('./config/globalPush');
  app.use(globalChannel, {
    GlobalChannel: {
      host: globalPush.host || '127.0.0.1',
      port: globalPush.port || 6973,
      db: globalPush.db || '0',       // optinal, from 0 to 15 with default redis configure
      no_ready_check:true             // https://www.cnblogs.com/hxdoit/p/8664946.html  修正Redis connection lost and command aborted
    }
  });
});

// app.configure('production|development', function(){
//     app.loadConfig('mysql_game_rw'  , app.getBase() + '/config/'+app.get('env')+'/mysql/mysql_game_rw.json');
//     app.loadConfig('mysql_game_r'   , app.getBase() + '/config/'+app.get('env')+'/mysql/mysql_game_r.json');
//     app.loadConfig('mysql_wagers_rw', app.getBase() + '/config/'+app.get('env')+'/mysql/mysql_wagers_rw.json'); //讀寫
//     app.loadConfig('mysql_log_rw', app.getBase() + '/config/'+app.get('env')+'/mysql/mysql_log_rw.json');
//     app.set('dbclient_g_rw', mysql.init( app.get('mysql_game_rw') ) );
//     app.set('dbclient_g_r',  mysql.init( app.get('mysql_game_r') ) );
//     app.set('dbclient_w_rw', mysql.init( app.get('mysql_wagers_rw') ));
//     app.set('dbclient_l_rw', mysql.init( app.get('mysql_log_rw') ));
// });

app.configure('production|development', 'fishHunter|fishHunterBackend|fishHunterCollider|webconnector|fishHunterRC', function () {
  const dbSync = require('./config/dbSync');

  const opts = {
    path: __dirname + '/app/cache/mapping',
    interval: 180 * 1000,
    aof: true,
    dbclient: app
  };
  for (const k in dbSync) {
    opts[k] = dbSync[k];
  }

  app.use(sync, {sync: opts});

  app.use(configLoader, {});
  // const loader = app.get('jsonLoader');
  //
  // logger.warn('configLoader ',loader.getData('serverCnf'))



});

//Gate settings
app.configure('all', 'gate', function () {
  app.set('connectorConfig', {
    connector: pomelo.connectors.hybridconnector,
    heartbeat: 30,
    useDict: true,
    useProtobuf: false
  });

  app.set('sessionConfig', {
    singleSession: true,
  });



});

//Connector settings
app.configure('all', 'connector', function () {
  app.set('connectorConfig', {
    connector: pomelo.connectors.hybridconnector,
    heartbeat: 30,
    disconnectOnTimeout: true,
    useDict: true,
    useProtobuf: false
  });

  app.set('sessionConfig', {
    singleSession: true,
  });

  const dbSync = require('./config/dbSync');
  const opts = {
    path: __dirname + '/app/cache/mapping',
    interval: 180 * 1000,
    aof: true,
    dbclient: app
  };
  for (const k in dbSync) {
    opts[k] = dbSync[k];
  }
  app.use(sync, {sync: opts});

  app.use(configLoader, {});
  // app.loadConfigBaseApp("ssoConfig", "/statics/config/SSOConfig.json", true);



});

app.configure('all', 'webconnector', function () {
  app.set('connectorConfig',
      {
        connector: webconnector.webconnector,
        methods: 'all',/// 'get' or 'post' 'all' = 'get' & 'post'
        useSSL: false,
        ssl: {
          // key:fs.readFileSync('../shared/server.key'),
          // cert:fs.readFileSync('../shared/server.crt')
        },
        jwtPrivateKey: fs.readFileSync('./config/jwt/private.pem'),
        jwtPublicKey: fs.readFileSync('./config/jwt/public.pem'),
        handlerFilter: function (route) {
          const filterRoute = [
            // 'webconnector.authServer.auth',
            //'webconnector.authServer.wechatLogin',
            // 'webconnector.configServer.getDieProbability',
            // 'webconnector.configServer.getExpectProbability',
            // 'webconnector.configServer.updateConfigFile'
          ]

          for (let i = 0; i < filterRoute.length; i++) {
            if (route == filterRoute[i]) {
              return true;
            }
          }

          return false;
        },
        routers: [
          // {path: '/api', router: require('./app/expressRouter/wechatPay')(app)},
          {path: '/platform', router: require('./app/expressRouter/apiPlatform')(app)},
        ],
        timeOut: 25000
      });

  app.lifecycleCbs[pomeloConstants.LIFECYCLE.AFTER_STARTUP] = function (app, cb) {

    if (app.getServerType() === 'webconnector') {
      const connector = app.components.__connector__.connector;

      if (!!connector) {
        // const {ApolloServer} = require('apollo-server-express');
        // const {typeDefs, resolvers} = require('./app/expressRouter/schema');
        // const {makeExecutableSchema} = require('graphql-tools');
        // const acl = require('acl');
        // const memdbBackend = require('./app/utils/memdb-backend')
        //
        // const schema = makeExecutableSchema({typeDefs, resolvers});
        //
        // const oldFun = app.memdb.goose.autoconn.collection;
        // app.memdb.goose.autoconn.collection = function (name, cb) {
        //   const ret = oldFun.call(app.memdb.goose.autoconn, name);
        //   if (!!cb) {
        //     cb(null, ret);
        //   }
        //
        //   return ret;
        // };
        //
        // const aclIns = new acl(new memdbBackend(app.memdb.goose.autoconn, 'acl_', true));
        //
        // const apollo = new ApolloServer({
        //   // These will be defined for both new or existing servers
        //   schema,
        //   mocks: false,
        //   context: ({req}) => ({
        //     // authScope: getScope(req.headers.authorization)
        //     app: app,
        //     acl: aclIns
        //   })
        // });
        // apollo.applyMiddleware({app: connector.express}); // app is from an existing express app
        //
        // // Add subscription support
        // apollo.installSubscriptionHandlers(connector.server)

        logger.warn(
            'GraphQL Server ready at'
            // `http${config.ssl ? 's' : ''}://${config.hostname}:${config.port}${apollo.graphqlPath}`
        );
      }
    }

    cb();
  };
});

app.configure('development', function () {
  // require('heapdump');
  quick.Promise.longStackTraces();
  quick.logger.setGlobalLogLevel(quick.logger.levels.WARN);
  // pomeloLogger.setGlobalLogLevel(pomeloLogger.levels.WARN);
});

app.configure('production', function () {
  quick.logger.setGlobalLogLevel(quick.logger.levels.WARN);
  // pomeloLogger.setGlobalLogLevel(pomeloLogger.levels.WARN);
});
// let mem = require('./config/memdb.conf');
// let REDIS_HOST = mem.locking.host;
// let REDIS_PORT = mem.locking.port;
// let redis = require('then-redis');
// app.redis = redis.createClient({
//     host: REDIS_HOST,
//     port: REDIS_PORT
// })


process.on('uncaughtException', function (err) {
  logger.error('Uncaught exception: %s', err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection. message', reason, promise);
  logger.error('Unhandled Promise Rejection. stack', reason.stack);
});

app.start();

