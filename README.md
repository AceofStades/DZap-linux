# DZap

Drive Zap: A secure, cross-platform data wiping application that works on Windows, Linux, and Android devices.

SIH PS: 25070


To run backend:
```
cd server
cargo build --release
sudo ./target/release/server
```

To run frontend open a new terminal:
```
npm run start:frontend
```

Dependencies:
```
util-linux
smartmontools
android-tools
```

Node Dependencies:
```
npm install cross-env --save-dev
```
