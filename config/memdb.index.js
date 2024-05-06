'use strict';

module.exports = {
    // Collection name
    ///////////////////////////
    fish_hunter_player: {
        // Index setting, modify it on your need
        indexes: [
            {
                keys: ['gameId'],
                valueIgnore: {
                    gameId: ['', -1]
                }
            },
            {
                keys: ['currency'],
                valueIgnore: {
                    currency: ['', -1]
                }
            },
            {
                keys: ['currency', 'gameId'],
                valueIgnore: {
                    currency: ['', -1],
                    gameId: ['', -1]
                }
            },
            {
                keys: ['accountState'],
                valueIgnore: {
                    accountState: ['', -1]
                }
            },
        ]
    },
    fish_hunter_area_players: {
        // Index setting, modify it on your need
        indexes: [
            {
                keys: ['areaId'],
                valueIgnore: {
                    areaId: ['', -1]
                }
            },
            {
                keys: ['playerId', 'areaId'],
                unique: true,
                valueIgnore: {
                    tableId: ['', -1],
                    playerId: ['', -1]
                }
            }
        ]
    },

    game_tokens: {
        // Index setting, modify it on your need
        indexes: [
            {
                keys: ['playerId', 'gameId'],
                valueIgnore: {
                    playerId: ['', -1],
                    gameId: ['', -1]
                }
            }
        ]
    },

///////////////////////////////

    fish_hunter_score_in_out: {
        // Index setting, modify it on your need
        indexes: [
            {
                keys: ['gameId'],
                valueIgnore: {
                    playerId: ['', -1]
                }
            }
        ]
    }
};
