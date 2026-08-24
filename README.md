It's HIGH NOON!


Wait for the DRAW! and shoot your opponent dead before he shoots you!

Peer to peer - one player starts a table, everybody else joins with the
4 character table code. The rules run in the host's browser over WebRTC data
channels (PeerJS); there is no game server. `server.js` only serves the files.

Reaction times are measured entirely inside your own tab: the draw instant is
scheduled on a shared clock and handed out seconds in advance, then each player
times their keypress against the frame that painted DRAW! on their own screen.
Ping never gets added to your time, and hosting gives no advantage.
