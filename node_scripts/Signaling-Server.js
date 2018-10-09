// Muaz Khan      - www.MuazKhan.com
// MIT License    - www.WebRTC-Experiment.com/licence
// Documentation  - github.com/muaz-khan/RTCMultiConnection

var listOfUsers = {};
var listOfRooms = {};
var adminSocket;

// for scalable-broadcast demos
var ScalableBroadcast;

// pushLogs is used to write error logs into logs.json
var pushLogs = require('./pushLogs.js');

module.exports = exports = function(root, app, socketCallback) {
    socketCallback = socketCallback || function() {};

    if (!!app.listen) {
        var io = require('socket.io');

        try {
            // use latest socket.io
            io = io(app);
            io.on('connection', onConnection);
        } catch (e) {
            // otherwise fallback
            io = io.listen(app, {
                log: false,
                origins: '*:*'
            });

            io.set('transports', [
                'websocket',
                'xhr-polling',
                'jsonp-polling'
            ]);

            io.sockets.on('connection', onConnection);
        }
    } else {
        onConnection(app);
    }

    // to secure your socket.io usage: (via: docs/tips-tricks.md)
    // io.set('origins', 'https://domain.com');

    function appendUser(socket, params) {
        try {
            var extra = params.extra;

            var params = socket.handshake.query;

            if (params.extra) {
                try {
                    if (typeof params.extra === 'string') {
                        params.extra = JSON.parse(params.extra);
                    }
                    extra = params.extra;
                } catch (e) {
                    extra = params.extra;
                }
            }

            listOfUsers[socket.userid] = {
                socket: socket,
                connectedWith: {},
                isPublic: false, // means: isPublicModerator
                extra: extra || {},
                admininfo: {},
                maxParticipantsAllowed: params.maxParticipantsAllowed || 1000,
                socketMessageEvent: params.socketMessageEvent || '',
                socketCustomEvent: params.socketCustomEvent || ''
            };
        } catch (e) {
            pushLogs(root, 'appendUser', e);
        }

        sendToAdmin();
    }

    function sendToAdmin() {
        try {
            if (adminSocket) {
                var users = [];
                // temporarily disabled
                false && Object.keys(listOfUsers).forEach(function(userid) {
                    try {
                        var item = listOfUsers[userid];
                        if (!item) return; // maybe user just left?

                        if (!item.connectedWith) {
                            item.connectedWith = {};
                        }

                        if (!item.socket) {
                            item.socket = {};
                        }

                        users.push({
                            userid: userid,
                            admininfo: item.socket.admininfo || '',
                            connectedWith: Object.keys(item.connectedWith)
                        });
                    } catch (e) {
                        pushLogs(root, 'admin.user-looper', e);
                    }
                });

                adminSocket.emit('admin', {
                    listOfRooms: listOfRooms,
                    listOfUsers: Object.keys(listOfUsers).length // users
                });
            }
        } catch (e) {
            pushLogs(root, 'admin', e);
        }
    }

    function handleAdminSocket(socket, params) {
        if (!app.request || !app.isAdminAuthorized || !app.config || !app.isAdminAuthorized(app.request, app.config)) {
            var adminAuthorization = require('basic-auth');
            var credentials = adminAuthorization(app.request);

            pushLogs(root, 'invalid-admin', {
                message: 'Invalid username or password attempted.',
                stack: credentials ? ('name: ' + credentials.name + '\n' + 'password: ' + credentials.pass) : 'Without any UserName or Password.'
            });

            socket.disconnect();
            return;
        }

        adminSocket = socket;
        socket.on('admin', function(message, callback) {
            if (!app.request || !app.isAdminAuthorized || !app.config || !app.isAdminAuthorized(app.request, app.config)) {
                var adminAuthorization = require('basic-auth');
                var credentials = adminAuthorization(app.request);

                pushLogs(root, 'invalid-admin', {
                    message: 'Invalid username or password attempted.',
                    stack: credentials ? ('name: ' + credentials.name + '\n' + 'password: ' + credentials.pass) : 'Without any UserName or Password.'
                });

                socket.disconnect();
                return;
            }

            callback = callback || function() {};

            if (message.all === true) {
                sendToAdmin();
            }

            if (message.userinfo === true && message.userid) {
                try {
                    var user = listOfUsers[message.userid];
                    if (user) {
                        callback(user.socket.admininfo || {});
                    } else {
                        callback({
                            error: 'User-id "' + message.userid + '" does not exist.'
                        });
                    }
                } catch (e) {
                    pushLogs(root, 'userinfo', e);
                }
            }

            if (message.clearLogs === true) {
                // last callback parameter will force to clear logs
                pushLogs(root, '', '', callback);
            }

            if (message.deleteUser === true) {
                try {
                    var user = listOfUsers[message.userid];

                    if (user) {
                        if (user.socket.owner) {
                            // delete listOfRooms[user.socket.owner];
                        }

                        user.socket.disconnect();
                    }

                    // delete listOfUsers[message.userid];
                    callback(true);
                } catch (e) {
                    pushLogs(root, 'deleteUser', e);
                    callback(false);
                }
            }

            if (message.deleteRoom === true) {
                try {
                    var room = listOfRooms[message.roomid];

                    if (room) {
                        var participants = room.participants;
                        delete listOfRooms[message.roomid];
                        participants.forEach(function(userid) {
                            var user = listOfUsers[userid];
                            if (user) {
                                user.socket.disconnect();
                            }
                        });
                    }
                    callback(true);
                } catch (e) {
                    pushLogs(root, 'deleteRoom', e);
                    callback(false);
                }
            }
        });
    }

    function onConnection(socket) {
        var params = socket.handshake.query;

        if(!params.userid) {
            params.userid = (Math.random() * 100).toString().replace('.', '');
        }

        if(!params.sessionid) {
            params.sessionid = (Math.random() * 100).toString().replace('.', '');
        }

        if (params.extra) {
            try {
                params.extra = JSON.parse(params.extra);
            } catch (e) {
                params.extra = {};
            }
        } else {
            params.extra = {};
        }

        var socketMessageEvent = params.msgEvent || 'RTCMultiConnection-Message';

        // for admin's record
        params.socketMessageEvent = socketMessageEvent;

        var autoCloseEntireSession = params.autoCloseEntireSession === true || params.autoCloseEntireSession === 'true';
        var sessionid = params.sessionid;
        var maxParticipantsAllowed = params.maxParticipantsAllowed || 1000;
        var enableScalableBroadcast = params.enableScalableBroadcast === true || params.enableScalableBroadcast === 'true';

        if (params.userid === 'admin') {
            handleAdminSocket(socket, params);
            return;
        }

        if (enableScalableBroadcast === true) {
            try {
                if (!ScalableBroadcast) {
                    // path to scalable broadcast script must be accurate
                    ScalableBroadcast = require('./Scalable-Broadcast.js');
                }
                ScalableBroadcast(root, socket, params.maxRelayLimitPerUser);
            } catch (e) {
                pushLogs(root, 'ScalableBroadcast', e);
            }

            // scalable-broadcast can ignore rest of the codes
            // however it must have evens like open-room, join-room, and socketMessageEvent
            // return;
        }

        // [disabled]
        if (false && !!listOfUsers[params.userid]) {
            params.dontUpdateUserId = true;

            var useridAlreadyTaken = params.userid;
            params.userid = (Math.random() * 1000).toString().replace('.', '');
            socket.emit('userid-already-taken', useridAlreadyTaken, params.userid);
            return;
        }

        socket.userid = params.userid;
        appendUser(socket, params);

        socket.on('extra-data-updated', function(extra) {
            try {
                if (!listOfUsers[socket.userid]) return;

                if (listOfUsers[socket.userid].socket.admininfo) {
                    listOfUsers[socket.userid].socket.admininfo.extra = extra;
                }

                // todo: use "admininfo.extra" instead of below one
                listOfUsers[socket.userid].extra = extra;

                try {
                    for (var user in listOfUsers[socket.userid].connectedWith) {
                        try {
                            listOfUsers[user].socket.emit('extra-data-updated', socket.userid, extra);
                        } catch (e) {
                            pushLogs(root, 'extra-data-updated.connectedWith', e);
                        }
                    }
                } catch (e) {
                    pushLogs(root, 'extra-data-updated.connectedWith', e);
                }

                // sent alert to all room participants
                if (!socket.admininfo) {
                    sendToAdmin();
                    return;
                }

                var roomid = socket.admininfo.sessionid;
                if (roomid && listOfRooms[roomid]) {
                    if (socket.userid == listOfRooms[roomid].owner) {
                        // room's extra must match owner's extra
                        listOfRooms[roomid].extra = extra;
                    }
                    listOfRooms[roomid].participants.forEach(function(pid) {
                        try {
                            var user = listOfUsers[pid];
                            if (!user) {
                                // todo: remove this user from participants list
                                return;
                            }

                            user.socket.emit('extra-data-updated', socket.userid, extra);
                        } catch (e) {
                            pushLogs(root, 'extra-data-updated.participants', e);
                        }
                    });
                }

                sendToAdmin();
            } catch (e) {
                pushLogs(root, 'extra-data-updated', e);
            }
        });

        socket.on('get-remote-user-extra-data', function(remoteUserId, callback) {
            callback = callback || function() {};
            if (!remoteUserId || !listOfUsers[remoteUserId]) {
                callback('remoteUserId (' + remoteUserId + ') does NOT exist.');
                return;
            }
            callback(listOfUsers[remoteUserId].extra);
        });

        socket.on('become-a-public-moderator', function() {
            try {
                if (!listOfUsers[socket.userid]) return;
                listOfUsers[socket.userid].isPublic = true;
            } catch (e) {
                pushLogs(root, 'become-a-public-moderator', e);
            }
        });

        var dontDuplicateListeners = {};
        socket.on('set-custom-socket-event-listener', function(customEvent) {
            if (dontDuplicateListeners[customEvent]) return;
            dontDuplicateListeners[customEvent] = customEvent;

            socket.on(customEvent, function(message) {
                try {
                    socket.broadcast.emit(customEvent, message);
                } catch (e) {}
            });
        });

        socket.on('dont-make-me-moderator', function() {
            try {
                if (!listOfUsers[socket.userid]) return;
                listOfUsers[socket.userid].isPublic = false;
            } catch (e) {
                pushLogs(root, 'dont-make-me-moderator', e);
            }
        });

        socket.on('get-public-moderators', function(userIdStartsWith, callback) {
            try {
                userIdStartsWith = userIdStartsWith || '';
                var allPublicModerators = [];
                for (var moderatorId in listOfUsers) {
                    if (listOfUsers[moderatorId].isPublic && moderatorId.indexOf(userIdStartsWith) === 0 && moderatorId !== socket.userid) {
                        var moderator = listOfUsers[moderatorId];
                        allPublicModerators.push({
                            userid: moderatorId,
                            extra: moderator.extra
                        });
                    }
                }

                callback(allPublicModerators);
            } catch (e) {
                pushLogs(root, 'get-public-moderators', e);
            }
        });

        socket.on('changed-uuid', function(newUserId, callback) {
            callback = callback || function() {};

            if (params.dontUpdateUserId) {
                delete params.dontUpdateUserId;
                return;
            }

            try {
                if (listOfUsers[socket.userid] && listOfUsers[socket.userid].socket.userid == socket.userid) {
                    if (newUserId === socket.userid) return;

                    var oldUserId = socket.userid;
                    listOfUsers[newUserId] = listOfUsers[oldUserId];
                    listOfUsers[newUserId].socket.userid = socket.userid = newUserId;
                    delete listOfUsers[oldUserId];

                    callback();
                    return;
                }

                socket.userid = newUserId;
                appendUser(socket, params);

                callback();
            } catch (e) {
                pushLogs(root, 'changed-uuid', e);
            }
        });

        socket.on('set-password', function(password) {
            try {
                if (!socket.admininfo) {
                    return;
                }

                var roomid = socket.admininfo.sessionid;

                if (listOfRooms[roomid] && listOfRooms[roomid].owner == socket.userid) {
                    listOfRooms[roomid].password = password;
                }
            } catch (e) {
                pushLogs(root, 'set-password', e);
            }
        });

        socket.on('disconnect-with', function(remoteUserId, callback) {
            try {
                if (listOfUsers[socket.userid] && listOfUsers[socket.userid].connectedWith[remoteUserId]) {
                    delete listOfUsers[socket.userid].connectedWith[remoteUserId];
                    socket.emit('user-disconnected', remoteUserId);
                    sendToAdmin();
                }

                if (!listOfUsers[remoteUserId]) return callback();

                if (listOfUsers[remoteUserId].connectedWith[socket.userid]) {
                    delete listOfUsers[remoteUserId].connectedWith[socket.userid];
                    listOfUsers[remoteUserId].socket.emit('user-disconnected', socket.userid);
                    sendToAdmin();
                }
                callback();
            } catch (e) {
                pushLogs(root, 'disconnect-with', e);
            }
        });

        socket.on('close-entire-session', function(callback) {
            try {
                var connectedWith = listOfUsers[socket.userid].connectedWith;
                Object.keys(connectedWith).forEach(function(key) {
                    if (connectedWith[key] && connectedWith[key].emit) {
                        try {
                            connectedWith[key].emit('closed-entire-session', socket.userid, listOfUsers[socket.userid].extra);
                        } catch (e) {}
                    }
                });
                callback();
            } catch (e) {
                pushLogs(root, 'close-entire-session', e);
            }
        });

        socket.on('check-presence', function(roomid, callback) {
            try {
                if (!listOfRooms[roomid]) {
                    callback(false, roomid, {});
                } else {
                    callback(true, roomid, listOfRooms[roomid].extra);
                }
            } catch (e) {
                pushLogs(root, 'check-presence', e);
            }
        });

        function onMessageCallback(message) {
            try {
                if (!listOfUsers[message.sender]) {
                    socket.emit('user-not-found', message.sender);
                    return;
                }

                if (!message.message.userLeft && !listOfUsers[message.sender].connectedWith[message.remoteUserId] && !!listOfUsers[message.remoteUserId]) {
                    listOfUsers[message.sender].connectedWith[message.remoteUserId] = listOfUsers[message.remoteUserId].socket;
                    listOfUsers[message.sender].socket.emit('user-connected', message.remoteUserId);

                    if (!listOfUsers[message.remoteUserId]) {
                        listOfUsers[message.remoteUserId] = {
                            socket: null,
                            connectedWith: {},
                            isPublic: false,
                            extra: {},
                            admininfo: {},
                            maxParticipantsAllowed: params.maxParticipantsAllowed || 1000
                        };
                    }

                    listOfUsers[message.remoteUserId].connectedWith[message.sender] = socket;

                    if (listOfUsers[message.remoteUserId].socket) {
                        listOfUsers[message.remoteUserId].socket.emit('user-connected', message.sender);
                    }

                    sendToAdmin();
                }

                if (listOfUsers[message.sender].connectedWith[message.remoteUserId] && listOfUsers[socket.userid]) {
                    message.extra = listOfUsers[socket.userid].extra;
                    listOfUsers[message.sender].connectedWith[message.remoteUserId].emit(socketMessageEvent, message);

                    sendToAdmin();
                }
            } catch (e) {
                pushLogs(root, 'onMessageCallback', e);
            }
        }

        function joinARoom(message) {
            try {
                if (!socket.admininfo || !socket.admininfo.sessionid) return;

                // var roomid = message.remoteUserId;
                var roomid = socket.admininfo.sessionid;

                if (!listOfRooms[roomid]) return; // find a solution?

                if (listOfRooms[roomid].participants.length > params.maxParticipantsAllowed) {
                    socket.emit('room-full', roomid);
                    return;
                }

                if (listOfRooms[roomid].session && (listOfRooms[roomid].session.oneway === true || listOfRooms[roomid].session.broadcast === true)) {
                    var owner = listOfRooms[roomid].owner;
                    if (listOfUsers[owner]) {
                        message.remoteUserId = owner;

                        if (enableScalableBroadcast === false) {
                            // only send to owner i.e. only connect with room owner
                            listOfUsers[owner].socket.emit(socketMessageEvent, message);
                        }
                    }
                    return;
                }

                // redundant?
                // appendToRoom(roomid, socket.userid);

                if (enableScalableBroadcast === false) {
                    // connect with all participants
                    listOfRooms[roomid].participants.forEach(function(pid) {
                        if (pid === socket.userid || !listOfUsers[pid]) return;

                        var user = listOfUsers[pid];
                        message.remoteUserId = pid;
                        user.socket.emit(socketMessageEvent, message);
                    });
                }
            } catch (e) {
                pushLogs(root, 'joinARoom', e);
            }

            sendToAdmin();
        }

        function appendToRoom(roomid, userid) {
            try {
                if (!listOfRooms[roomid]) {
                    listOfRooms[roomid] = {
                        isPublic: params.isPublic || false,
                        maxParticipantsAllowed: params.maxParticipantsAllowed || 1000,
                        owner: userid, // this can change if owner leaves and if control shifts
                        participants: [userid],
                        extra: {}, // usually owner's extra-data
                        socketMessageEvent: '',
                        socketCustomEvent: '',
                        session: {
                            audio: true,
                            video: true
                        }
                    };
                }

                if (listOfRooms[roomid].participants.indexOf(userid) !== -1) return;
                listOfRooms[roomid].participants.push(userid);
            } catch (e) {
                pushLogs(root, 'appendToRoom', e);
            }
        }

        function closeOrShiftRoom() {
            try {
                if (!socket.admininfo) {
                    return;
                }

                var roomid = socket.admininfo.sessionid;

                if (roomid && listOfRooms[roomid]) {
                    if (socket.userid === listOfRooms[roomid].owner) {
                        if (autoCloseEntireSession === false && listOfRooms[roomid].participants.length > 1) {
                            var firstParticipant;
                            listOfRooms[roomid].participants.forEach(function(pid) {
                                if (firstParticipant || pid === socket.userid) return;
                                if (!listOfUsers[pid]) return;
                                firstParticipant = listOfUsers[pid];
                            });

                            if (firstParticipant) {
                                // reset owner priviliges
                                listOfRooms[roomid].owner = firstParticipant.socket.userid;

                                // "become-next-modrator" merely sets "connection.isInitiator=true"
                                // though it is not important; maybe below line is redundant?
                                firstParticipant.socket.emit('become-next-modrator', roomid);

                                // remove moderator from room's participants list
                                var newParticipantsList = [];
                                listOfRooms[roomid].participants.forEach(function(pid) {
                                    if (pid != socket.userid) {
                                        newParticipantsList.push(pid);
                                    }
                                });
                                listOfRooms[roomid].participants = newParticipantsList;
                            } else {
                                delete listOfRooms[roomid];
                            }
                        } else {
                            delete listOfRooms[roomid];
                        }
                    } else {
                        var newParticipantsList = [];
                        listOfRooms[roomid].participants.forEach(function(pid) {
                            if (pid && pid != socket.userid && listOfUsers[pid]) {
                                newParticipantsList.push(pid);
                            }
                        });
                        listOfRooms[roomid].participants = newParticipantsList;
                    }
                }
            } catch (e) {
                pushLogs(root, 'closeOrShiftRoom', e);
            }
        }

        var numberOfPasswordTries = 0;
        socket.on(socketMessageEvent, function(message, callback) {
            if (message.remoteUserId && message.remoteUserId === socket.userid) {
                // remoteUserId MUST be unique
                return;
            }

            try {
                if (message.remoteUserId && message.remoteUserId != 'system' && message.message.newParticipationRequest) {
                    if (listOfRooms[message.remoteUserId] && listOfRooms[message.remoteUserId].password) {
                        if (numberOfPasswordTries > 3) {
                            socket.emit('password-max-tries-over', message.remoteUserId);
                            return;
                        }

                        if (!message.password) {
                            numberOfPasswordTries++;
                            socket.emit('join-with-password', message.remoteUserId);
                            return;
                        }

                        if (message.password != listOfRooms[message.remoteUserId].password) {
                            numberOfPasswordTries++;
                            socket.emit('invalid-password', message.remoteUserId, message.password);
                            return;
                        }
                    }

                    if (enableScalableBroadcast === true) {
                        var user = listOfUsers[message.remoteUserId];
                        if (user) {
                            user.socket.emit(socketMessageEvent, message);
                        }

                        if (listOfUsers[socket.userid] && listOfUsers[socket.userid].extra.broadcastId) {
                            // for /admin/ page
                            appendToRoom(listOfUsers[socket.userid].extra.broadcastId, socket.userid);
                        }
                    } else if (listOfRooms[message.remoteUserId]) {
                        joinARoom(message);
                        return;
                    }
                }

                // for v3 backward compatibility; >v3.3.3 no more uses below block
                if (message.remoteUserId == 'system') {
                    if (message.message.detectPresence) {
                        if (message.message.userid === socket.userid) {
                            callback(false, socket.userid);
                            return;
                        }

                        callback(!!listOfUsers[message.message.userid], message.message.userid);
                        return;
                    }
                }

                if (!listOfUsers[message.sender]) {
                    listOfUsers[message.sender] = {
                        socket: socket,
                        connectedWith: {},
                        isPublic: false,
                        extra: {},
                        admininfo: {},
                        maxParticipantsAllowed: params.maxParticipantsAllowed || 1000
                    };
                }

                // if someone tries to join a person who is absent
                // -------------------------------------- DISABLED
                if (false && message.message.newParticipationRequest) {
                    var waitFor = 60 * 10; // 10 minutes
                    var invokedTimes = 0;
                    (function repeater() {
                        if (typeof socket == 'undefined' || !listOfUsers[socket.userid]) {
                            return;
                        }

                        invokedTimes++;
                        if (invokedTimes > waitFor) {
                            socket.emit('user-not-found', message.remoteUserId);
                            return;
                        }

                        // if user just come online
                        if (listOfUsers[message.remoteUserId] && listOfUsers[message.remoteUserId].socket) {
                            joinARoom(message);
                            return;
                        }

                        setTimeout(repeater, 1000);
                    })();

                    return;
                }

                onMessageCallback(message);
            } catch (e) {
                pushLogs(root, 'on-socketMessageEvent', e);
            }
        });

        socket.on('open-room', function(arg, callback) {
            callback = callback || function() {};

            try {
                // if already joined a room, either leave or close it
                closeOrShiftRoom();

                if (listOfRooms[arg.sessionid]) {
                    callback(false, 'Room in use. Pease join instead or create another room.');
                    return;
                }

                if (enableScalableBroadcast === true) {
                    arg.session.scalable = true;
                    arg.sessionid = arg.extra.broadcastId;
                }

                // maybe redundant?
                if (!listOfUsers[socket.userid]) {
                    listOfUsers[socket.userid] = {
                        socket: socket,
                        connectedWith: {},
                        isPublic: false, // means: isPublicModerator
                        extra: arg.extra,
                        admininfo: {},
                        maxParticipantsAllowed: params.maxParticipantsAllowed || 1000,
                        socketMessageEvent: params.socketMessageEvent || '',
                        socketCustomEvent: params.socketCustomEvent || ''
                    };
                }
                listOfUsers[socket.userid].extra = arg.extra;

                if (arg.session && (arg.session.oneway === true || arg.session.broadcast === true)) {
                    autoCloseEntireSession = true;
                }
            } catch (e) {
                pushLogs(root, 'open-room', e);
            }

            // append this user into participants list
            appendToRoom(arg.sessionid, socket.userid);

            try {
                // override owner & session
                if (enableScalableBroadcast === true) {
                    if (Object.keys(listOfRooms[arg.sessionid]).length == 1) {
                        listOfRooms[arg.sessionid].owner = socket.userid;
                        listOfRooms[arg.sessionid].session = arg.session;
                    }
                } else {
                    // for non-scalable-broadcast demos
                    listOfRooms[arg.sessionid].owner = socket.userid;
                    listOfRooms[arg.sessionid].session = arg.session;
                    listOfRooms[arg.sessionid].extra = arg.extra || {};
                    listOfRooms[arg.sessionid].socketMessageEvent = listOfUsers[socket.userid].socketMessageEvent;
                    listOfRooms[arg.sessionid].socketCustomEvent = listOfUsers[socket.userid].socketCustomEvent;

                    try {
                        if (typeof arg.password !== 'undefined' && arg.password.toString().length) {
                            // password protected room?
                            listOfRooms[arg.sessionid].password = arg.password;
                        }
                    } catch (e) {
                        pushLogs(root, 'open-room.password', e);
                    }
                }

                // admin info are shared only with /admin/
                listOfUsers[socket.userid].socket.admininfo = {
                    sessionid: arg.sessionid,
                    session: arg.session,
                    mediaConstraints: arg.mediaConstraints,
                    sdpConstraints: arg.sdpConstraints,
                    streams: arg.streams,
                    extra: arg.extra
                };
            } catch (e) {
                pushLogs(root, 'open-room', e);
            }

            sendToAdmin();

            try {
                callback(true);
            } catch (e) {
                pushLogs(root, 'open-room', e);
            }
        });

        socket.on('join-room', function(arg, callback) {
            callback = callback || function() {};

            try {
                // if already joined a room, either leave or close it
                closeOrShiftRoom();

                if (enableScalableBroadcast === true) {
                    arg.session.scalable = true;
                    arg.sessionid = arg.extra.broadcastId;
                }

                // maybe redundant?
                if (!listOfUsers[socket.userid]) {
                    listOfUsers[socket.userid] = {
                        socket: socket,
                        connectedWith: {},
                        isPublic: false, // means: isPublicModerator
                        extra: arg.extra,
                        admininfo: {},
                        maxParticipantsAllowed: params.maxParticipantsAllowed || 1000,
                        socketMessageEvent: params.socketMessageEvent || '',
                        socketCustomEvent: params.socketCustomEvent || ''
                    };
                }
                listOfUsers[socket.userid].extra = arg.extra;
            } catch (e) {
                pushLogs(root, 'join-room', e);
            }

            try {
                if (!listOfRooms[arg.sessionid]) {
                    callback(false, 'Room does not exist.');
                    return;
                }

                try {
                    if (listOfRooms[arg.sessionid].password && listOfRooms[arg.sessionid].password != arg.password) {
                        callback(false, 'Invalid password.');
                        return;
                    }
                } catch (e) {
                    pushLogs(root, 'join-room.password', e);
                }
            } catch (e) {
                pushLogs(root, 'join-room', e);
            }

            // append this user into participants list
            appendToRoom(arg.sessionid, socket.userid);

            try {
                // admin info are shared only with /admin/
                listOfUsers[socket.userid].socket.admininfo = {
                    sessionid: arg.sessionid,
                    session: arg.session,
                    mediaConstraints: arg.mediaConstraints,
                    sdpConstraints: arg.sdpConstraints,
                    streams: arg.streams,
                    extra: arg.extra
                };
            } catch (e) {
                pushLogs(root, 'join-room', e);
            }

            sendToAdmin();

            try {
                callback(true);
            } catch (e) {
                pushLogs(root, 'join-room', e);
            }
        });

        socket.on('disconnect', function() {
            try {
                if (socket && socket.namespace && socket.namespace.sockets) {
                    delete socket.namespace.sockets[this.id];
                }
            } catch (e) {
                pushLogs(root, 'disconnect', e);
            }

            try {
                // inform all connected users
                if (listOfUsers[socket.userid]) {
                    for (var s in listOfUsers[socket.userid].connectedWith) {
                        listOfUsers[socket.userid].connectedWith[s].emit('user-disconnected', socket.userid);

                        // sending duplicate message to same socket?
                        if (listOfUsers[s] && listOfUsers[s].connectedWith[socket.userid]) {
                            delete listOfUsers[s].connectedWith[socket.userid];
                            listOfUsers[s].socket.emit('user-disconnected', socket.userid);
                        }
                    }
                }
            } catch (e) {
                pushLogs(root, 'disconnect', e);
            }

            closeOrShiftRoom();

            delete listOfUsers[socket.userid];

            if (socket.ondisconnect) {
                // scalable-broadcast.js
                socket.ondisconnect();
            }

            sendToAdmin();
        });

        if (socketCallback) {
            socketCallback(socket);
        }
    }
};
