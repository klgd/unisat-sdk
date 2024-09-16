# UniSat Wallet SDK


## 安装
```shell
npm i @klgd/unisat-sdk
```

## 使用
```js

// Using ES6 modules with Babel or TypeScript
import { UniSat, Wallet, AddressType, NetworkType } from '@klgd/unisat-sdk';

// Using CommonJS modules
const { UniSat, Wallet, AddressType, NetworkType } = require('@klgd/unisat-sdk');

const WIF = '';

const chainType = ChainType.BITCOIN_MAINNET;
const wallet = new Wallet(WIF, AddressType.P2TR, chainType);
const unisat = new UniSat(wallet, API_BASE_URL[chainType]);

unisat.setMaxFeeRate(MAX_FEE); // 指定最大fee

const tx = await unisat.mintBrc20(tick, amount, count);
```

## 设置代理

某些情况下，需要使用到代理，这里用到 `cross-fetch` `https-proxy-agent` 两个包

### 安装

```shell
npm i https-proxy-agent@^6 cross-fetch
```

### 使用
```js
// import before @klgd/unisat-sdk
global.fetch = null;
// Using ES6 modules
import 'cross-fetch/polyfill';

// Using CommonJS modules
require('cross-fetch/polyfill');

// Using ES6 modules
import { HttpsProxyAgent } from 'https-proxy-agent';

// Using CommonJS modules
const { HttpsProxyAgent } = require("https-proxy-agent")

global.agent = new HttpsProxyAgent('代理地址');

```

## 浏览器端使用

```

```