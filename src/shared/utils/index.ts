import { NetworkType } from '../types';
import {
  core as unicore,
} from '@unisat/wallet-sdk';

// import { keyBy } from 'lodash';

// import browser from '@/background/webapi/browser';
import { AddressFlagType, CHAINS } from '../constant';


// import BroadcastChannelMessage from './message/broadcastChannelMessage';
// import PortMessage from './message/portMessage';

// const Message = {
//   BroadcastChannelMessage,
//   PortMessage
// };

// declare global {
//   const langLocales: Record<string, Record<'message', string>>;
// }

// const t = (name) => browser.i18n.getMessage(name);

// const format = (str, ...args) => {
//   return args.reduce((m, n) => m.replace('_s_', n), str);
// };

// export { Message, t, format };

// const chainsDict = keyBy(CHAINS, 'serverId');
// export const getChain = (chainId?: string) => {
//   if (!chainId) {
//     return null;
//   }
//   return chainsDict[chainId];
// };


// Check if address flag is enabled
export const checkAddressFlag = (currentFlag: number, flag: AddressFlagType): boolean => {
  return Boolean(currentFlag & flag);
};

export function toPsbtNetwork(networkType: NetworkType) {
  if (networkType === NetworkType.MAINNET) {
    return unicore.bitcoin.networks.bitcoin;
  } else if (networkType === NetworkType.TESTNET) {
    return unicore.bitcoin.networks.testnet;
  } else {
    return unicore.bitcoin.networks.regtest;
  }
}