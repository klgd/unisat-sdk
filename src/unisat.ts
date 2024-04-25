import { Wallet } from './wallet';
import { AddressType, NetworkType } from './shared/types';
import { createHash } from 'create-hash';
// import { bitcoin } from '@unisat/wallet-sdk/lib/bitcoin-core';
// import { satoshisToAmount } from '@unisat/wallet-sdk/lib/utils';
import { utils as uniutils, core as unicore } from '@unisat/wallet-sdk';

const API_BASE_URL = {
  [NetworkType.MAINNET]: 'https://api.unisat.io',
  [NetworkType.TESTNET]: 'https://api-testnet.unisat.io',
};

interface FileInfo {
  dataURL: string;
  filename: string;
}

export enum ExactType {
  exactOut = 'exactOut',
  exactIn = 'exactIn',
}

export class UniSat {
  wallet: Wallet;
  baseUrl: string;
  address: string;
  maxFeeRate: number = 50;

  constructor(
    wif: string,
    addressType: AddressType = AddressType.P2TR,
    networkType: NetworkType = NetworkType.MAINNET,
  ) {
    this.wallet = new Wallet(wif, addressType, networkType);
    this.address = this.wallet.getCurrentAccount().address;

    this.setBaseUrl(API_BASE_URL[networkType]);
  }

  setBaseUrl(url: string) {
    this.baseUrl = url;
  }

  setMaxFeeRate(val: number) {
    this.maxFeeRate = val;
  }

  // async swapIn(tick0: string, tick1: string, amount: string, slippage: string) {
  //   return this.swap(tick0, tick1, amount, slippage, ExactType.exactIn);

  // }
  // async swapOut(tick0: string, tick1: string, amount: string, slippage: string) {
  //   return this.swap(tick0, tick1, amount, slippage, ExactType.exactOut);
  // }

  async auctionList(nftType: string, tick: string, start: number = 0, limit: number = 20) {
    const body = JSON.stringify({
      filter:{
        nftType,
        nftConfirm: true,
        isEnd: false,
        tick
      },
      sort: {
        unitPrice: 1
      },
      start,
      limit,
      flash: true
    });

    // console.log(body)
    const res = await this.fetch(`/market-v4/${nftType}/auction/list`, 'POST', body);
    if (res) {
      console.log(`auctionList`);
      return res;
    }
    return res;
  }

  async mintRune(runeId: string, count: number, feeRate: number, receiver: string = this.address) {
    if (!feeRate) {
      const summary = await this.wallet.getFeeSummary();
      // console.log(summary)
      feeRate = summary.list[1].feeRate;
      if (feeRate > this.maxFeeRate) {
        throw new Error(`gas 超过指定值（${feeRate}）`);
      }
    }
    const order = await this.createRunesMintOrder(runeId, count, feeRate, receiver);
    if (order) {
      console.log(order);
      const txId = await this.sendBitcoin({
        toAddress: order.payAddress,
        toAmount: order.amount,
        feeRate: order.feeRate,
        enableRBF: false
      });
      console.log(txId);
      return txId;
    }

    return false;
  }

  async createRunesMintOrder(runeId: string, count: number, feeRate: number, receiver: string = this.address) {
    const body = JSON.stringify({
      runeId,
      count,
      receiver,
      feeRate,
      outputValue: 546,
      clientId: ''
        .concat(Math.random().toString(36).slice(-8))
        .concat(Math.random().toString(36).slice(-8)),
    });

    // console.log(body)
    const res = await this.fetch('/inscribe-v5/order/create/runes-mint', 'POST', body);
    if (res) {
      console.log(`create runes-mint order`);
      return res;
    }
    return res;
  }

  async buy(nftType: string, auctionId: string, bidPrice: number, feeRate: number = 0) {
    if (!feeRate) {
      const summary = await this.wallet.getFeeSummary();
      // console.log(summary)
      feeRate = summary.list[1].feeRate;
      if (feeRate > this.maxFeeRate) {
        throw new Error(`gas 超过指定值（${feeRate}）`);
      }
    }

    const order = await this.createBid(nftType, auctionId, bidPrice, feeRate);
    if (order) {
      const psbt = unicore.bitcoin.Psbt.fromHex(order.psbtBid);
      const psbtSign = await this.wallet.signPsbt(psbt, null, true);
      const txid = await this.confirmBid(nftType, auctionId, order.bidId, psbtSign.toHex());
      return txid;
    }

    return order;

  }


  async createBid(nftType: string, auctionId: string, bidPrice: number, feeRate: number) {
    const body = JSON.stringify({
      auctionId,
      bidPrice,
      address: this.address,
      pubkey: this.wallet.getCurrentAccount().pubkey,
      feeRate,
    });

    const res = await this.fetch(`/market-v4/${nftType}/auction/create_bid`, 'POST', body);
    if (res) {
      console.log(`create_bid`);
      return res;
    }
    return res;
  }

  async confirmBid(nftType: string, auctionId: string, bidId: string, psbtBid: string, psbtBid2: string = '', psbtSettle: string = '') {
    const body = JSON.stringify({
      auctionId,
      bidId,
      psbtBid,
      psbtBid2,
      psbtSettle,
      fromBase64: false,
      walletType: 'unisat'
    });

    const res = await this.fetch(`/market-v4/${nftType}/auction/confirm_bid`, 'POST', body);
    if (res) {
      console.log(`confirm_bid`);
      return res;
    }
    return res;
  }

  // async swap(
  //   tick0: string,
  //   tick1: string,
  //   amount: string,
  //   slippage: string,
  //   exactType: ExactType = ExactType.exactIn,
  // ) {
  //   const qAmount = await this.quoteSwap(tick0, tick1, amount, exactType);
  //   if (!qAmount) {
  //     console.log(`获取${tick1}兑换值失败`);
  //     return false;
  //   }
  //   const amount0 = exactType == ExactType.exactIn ? amount : qAmount;
  //   const amount1 = exactType == ExactType.exactIn ? qAmount : amount;
  //   const message = await this.preSwap(tick0, tick1, amount0, amount1, slippage, exactType);
  //   if (!message) {
  //     console.log('获取签名信息失败');
  //     return false;
  //   }

  //   const sig = await this.wallet.signBIP322Simple(message);
  //   // console.log(sig);

  //   if (!sig) {
  //     console.log('钱包签名失败');
  //     return false;
  //   }

  //   const res = await this.postSwap(tick0, tick1, amount0, amount1, slippage, exactType, sig);

  //   // console.log(res)
  //   return res;
  // }

  // async quoteSwap(tick0: string, tick1: string, amount: string, exactType: ExactType) {
  //   const tick = exactType == ExactType.exactIn ? tick0 : tick1;
  //   const uri = `/swap-v1/quote_swap?exactType=${exactType}&tick0=${tick0}&tick1=${tick1}&tick=${tick}&amount=${amount}&address=${this.address}`;

  //   const res = await this.fetch(uri, 'GET', '');
  //   if (res) {
  //     return res.amount;
  //   }

  //   return res;
  // }

  // async preSwap(
  //   tick0: string,
  //   tick1: string,
  //   amount0: string,
  //   amount1: string,
  //   slippage: string,
  //   exactType: ExactType,
  // ) {
  //   const ts = Math.floor(Date.now() / 1e3);
  //   const uri = `/swap-v1/pre_swap?address=${this.address}&tick0=${tick0}&tick1=${tick1}&amount0=${amount0}&amount1=${amount1}&slippage=${slippage}&exactType=${exactType}&ts=${ts}`;
  //   const res = await this.fetch(uri, 'GET', '');
  //   if (res) {
  //     return res.message;
  //   }
  //   return res;
  // }

  // async postSwap(
  //   tick0: string,
  //   tick1: string,
  //   amount0: string,
  //   amount1: string,
  //   slippage: string,
  //   exactType: ExactType,
  //   sig: string,
  // ) {
  //   const ts = Math.floor(Date.now() / 1e3);

  //   const body = JSON.stringify({
  //     address: this.address,
  //     amount0,
  //     amount1,
  //     exactType,
  //     sig,
  //     slippage,
  //     tick0,
  //     tick1,
  //     ts,
  //   });

  //   const res = await this.fetch('/swap-v1/swap', 'POST', body);
  //   if (res) {
  //     console.log(`Swapped ${amount0} ${tick0} for ${amount1} ${tick1}`);
  //     return res;
  //   }
  //   return res;
  // }

  // async quoteAddLiq0(tick0: string, tick1: string, amount: string) {
  //   return this.quoteAddLiq(tick0, tick1, amount, tick0);
  // }

  // async quoteAddLiq1(tick0: string, tick1: string, amount: string) {
  //   return this.quoteAddLiq(tick0, tick1, amount, tick1);
  // }

  // async quoteAddLiq(tick0: string, tick1: string, tick: string, amount: string) {
  //   const uri = `/swap-v1/quote_add_liq?tick0=${tick0}&tick1=${tick1}&tick=${tick}&amount=${amount}&address=${this.address}`;
  //   const res = await this.fetch(uri, 'GET', '');
  //   return res;
  // }

  // async preAddLiq(
  //   tick0: string,
  //   tick1: string,
  //   amount0: string,
  //   amount1: string,
  //   slippage: string,
  //   lp: string,
  // ) {
  //   const ts = Math.floor(Date.now() / 1e3);

  //   const uri = `/swap-v1/pre_add_liq?address=${this.address}&tick0=${tick0}&tick1=${tick1}&amount0=${amount0}&amount1=${amount1}&slippage=${slippage}&ts=${ts}&lp=${lp}`;
  //   const res = await this.fetch(uri, 'GET', '');
  //   if (res) {
  //     return res.message;
  //   }

  //   return res;
  // }

  // async postAddLiq(
  //   tick0: string,
  //   tick1: string,
  //   amount0: string,
  //   amount1: string,
  //   slippage: string,
  //   lp: string,
  //   sig: string,
  // ) {
  //   const ts = Math.floor(Date.now() / 1e3);
  //   const body = JSON.stringify({
  //     address: this.address,
  //     amount0,
  //     amount1,
  //     lp,
  //     sig,
  //     slippage,
  //     tick0,
  //     tick1,
  //     ts,
  //   });

  //   const res = await this.fetch('/swap-v1/add_liq', 'POST', body);
  //   if (res) {
  //     console.log(`Add Liquidity ${lp} ${tick0}/${tick1}`);
  //     return res;
  //   }
  //   return res;
  // }

  // async addLiq(tick0: string, tick1: string, tick: string, amount: string, slippage: string) {
  //   if (tick != tick0 && tick != tick1) {
  //     console.log('tick参数错误');
  //     return false;
  //   }
  //   const balance0 = await this.tickBalance(tick0);
  //   const balance1 = await this.tickBalance(tick1);
  //   const quote = await this.quoteAddLiq(tick0, tick1, tick, amount);
  //   if (!quote) {
  //     console.log(`获取LP值失败`);
  //     return false;
  //   }

  //   const amount0 = tick == tick0 ? amount : quote.amountB;
  //   const amount1 = tick == tick0 ? quote.amountB : amount;
  //   if (amount0 > balance0) {
  //     console.log(`${tick0} 余额不足`);
  //     return false;
  //   }

  //   if (amount1 > balance1) {
  //     console.log(`${tick1} 余额不足`);
  //     return false;
  //   }

  //   const lp = quote.lp;

  //   const message = await this.preAddLiq(tick0, tick1, amount0, amount1, slippage, lp);
  //   if (!message) {
  //     console.log('获取签名信息失败');
  //     return false;
  //   }
  //   const sig = await this.wallet.signBIP322Simple(message);
  //   // console.log(sig);

  //   if (!sig) {
  //     console.log('钱包签名失败');
  //     return false;
  //   }

  //   const res = await this.postAddLiq(tick0, tick1, amount0, amount1, slippage, lp, sig);

  //   // console.log(res)
  //   return res;
  // }

  async tickBalance(tick: string) {
    const uri = `/swap-v1/balance?address=${this.address}&tick=${tick}`;
    const res = await this.fetch(uri, 'GET', '');
    return res;
  }

  buildFiles(tick: string, amt: string, count: number) {
    const files: FileInfo[] = [];
    const filename = JSON.stringify({
      p: 'brc-20',
      op: 'mint',
      tick,
      amt,
    });
    // {"p":"brc-20","op":"mint","tick":"🪁","amt":"1000000"}
    const t = 48;
    for (let index = 0; index < count; index++) {
      const base64 = Buffer.from(filename).toString('base64');
      const element = {
        dataURL: `data:text/plain;charset=utf-8;base64,${base64}`,
        filename:
          filename.length <= t
            ? filename
            : ''
                .concat(filename.substring(0, t / 2), '...')
                .concat(filename.substring(filename.length - t / 2, filename.length)),
      };
      files.push(element);
    }

    return files;
  }

  async mintInscribe(tick: string, amount: string, count: number, feeRate: number = 0) {
    const files = this.buildFiles(tick, amount, count);
    // console.log(files)

    if (!feeRate) {
      const summary = await this.wallet.getFeeSummary();
      // console.log(summary)
      feeRate = summary.list[1].feeRate;
      if (feeRate > this.maxFeeRate) {
        throw new Error(`gas 超过指定值（${feeRate}）`);
      }
    }

    const order = await this.createInscribeOrder(files, feeRate);
    if (order) {
      // console.log(order);
      const txId = await this.sendBitcoin({
        toAddress: order.payAddress,
        toAmount: order.amount,
        feeRate: order.feeRate,
        enableRBF: false
      });
      console.log(txId);
      return txId;
    }

    return false;
  }

  async createInscribeOrder(files: Object[], feeRate: number) {
    const body = JSON.stringify({
      files,
      receiver: this.address,
      feeRate,
      outputValue: 330,
      clientId: ''
        .concat(Math.random().toString(36).slice(-8))
        .concat(Math.random().toString(36).slice(-8)),
    });

    // console.log(body)
    const res = await this.fetch('/inscribe-v5/order/create', 'POST', body);
    if (res) {
      console.log(`create inscribe order`);
      return res;
    }
    return res;
  }

  async inscribeBRC20Transfer(tick: string, amount: string, feeRate: number = 0) {
    if (!feeRate) {
      const summary = await this.wallet.getFeeSummary();
      // console.log(summary)
      feeRate = summary.list[1].feeRate;
      if (feeRate > this.maxFeeRate) {
        throw new Error(`gas 超过指定值（${feeRate}）`);
      }
    }

    // const order = await this.wallet.inscribeBRC20Transfer(this.address, tick, amount, feeRate);
    // if (order) {
    //   const txId = await this.wallet.sendBitcoin(order.payAddress, order.totalFee, feeRate);
    //   console.log(txId);
    // }
  }

  async sendBitcoin({
      toAddress,
      toAmount,
      feeRate,
      enableRBF,
      memo,
      memos,
      disableAutoAdjust
    }: {
      toAddress: string;
      toAmount: number;
      feeRate?: number;
      enableRBF: boolean;
      memo?: string;
      memos?: string[];
      disableAutoAdjust?: boolean;
    }) {
    const _utxos = await this.wallet.getBTCUtxos();

    const safeBalance = _utxos.filter((v) => v.inscriptions.length == 0).reduce((pre, cur) => pre + cur.satoshis, 0);
    if (safeBalance < toAmount) {
      throw new Error(
        `Insufficient balance. Non-Inscription balance(${uniutils.satoshisToAmount(
          safeBalance
        )} BTC) is lower than ${uniutils.satoshisToAmount(toAmount)} BTC `
      );
    }

    if (!feeRate) {
      const summary = await this.wallet.getFeeSummary();
      // console.log(summary)
      feeRate = summary.list[1].feeRate;
      if (feeRate > this.maxFeeRate) {
        throw new Error(`gas 超过指定值（${feeRate}）`);
      }
    }
    let psbtHex = '';

    if (safeBalance === toAmount && !disableAutoAdjust) {
      psbtHex = await this.wallet.sendAllBTC({
        to: toAddress,
        btcUtxos: _utxos,
        enableRBF,
        feeRate
      });
    } else {
      psbtHex = await this.wallet.sendBTC({
        to: toAddress,
        amount: toAmount,
        btcUtxos: _utxos,
        enableRBF,
        feeRate,
        memo,
        memos
      });
    }

    const psbt = unicore.bitcoin.Psbt.fromHex(psbtHex);
    const rawtx = psbt.extractTransaction().toHex();
    
    const txid = await this.wallet.pushTx(rawtx);

    return txid;
  }

  async fetch(uri: string, method: string, body: string) {
    const ts = Math.floor(Date.now() / 1e3);
    const signStr = `${uri}\n${body}\n${ts}@#?.#@deda5ddd2b3d84988b2cb0a207c4b74e`;
    // console.log(signStr)
    // const crypto = require('crypto');
    const sign = createHash('md5').update(signStr).digest('hex');
    // e.interceptors.request.use
    const headers = new Headers();
    headers.append(
      'user-agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/102.0.0.0 Safari/537.36',
    );
    headers.append('Accept', 'application/json, text/plain, */*');
    headers.append('Content-Type', 'application/json;charset=utf-8');
    // headers.append('unisat-session', '8a9a4641-5a22-4498-846d-5b3e20b03494');
    headers.append('X-AppID', '1adcd79696032b1753f1812c9461cd36');
    headers.append('X-Sign', sign);
    headers.append('X-Ts', ts.toString());
    const url = `${this.baseUrl}${uri}`;
    // console.log(url);
    const agent = global.agent || null;
    const res = await fetch(url, {
      method,
      headers,
      mode: 'cors',
      cache: 'default',
      // referrer: "https://unisat.io",
      // referrerPolicy: "no-referrer-when-downgrade",
      // credentials: "same-origin",
      // keepalive: true,
      body: body ? body : null,
      // @ts-ignore
      agent
    });
    // const data = await res.json();
    // console.log(data)
    if (res.status == 200) {
      const data = await res.json();
      // console.log(data)
      if (data.code == 0) {
        return data.data;
      }
      if (data.msg) {
        throw new Error(data.msg);
      }
      console.log(data);
      return false;
    } else {
      const text = await res.text();
      throw new Error(text);
      // console.log(t);
      // console.log(res);
      // console.log(`err ${res.statusText}`);
      // return false;
    }
  }
}
