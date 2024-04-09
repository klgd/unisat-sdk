# UniSat Wallet SDK

## Usage

```shell

npm i @klgd/unisat-sdk

```

```js

// Using ES6 modules with Babel or TypeScript
import { Wallet, AddressType, NetworkType } from '@klgd/unisat-sdk';

// Using CommonJS modules
const { Wallet, AddressType, NetworkType } = require('@klgd/unisat-sdk');

const WIF = '';
const wallet = new Wallet(WIF, AddressType.P2TR, NetworkType.MAINNET);
```