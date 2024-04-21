import {
  openapiService,
} from './service';

import {
  AddressFlagType,
  COIN_NAME,
  COIN_SYMBOL,
  NETWORK_TYPES,
  OPENAPI_URL_MAINNET,
  OPENAPI_URL_TESTNET,
  UNCONFIRMED_HEIGHT
} from './shared/constant';
import {
  AddressType,
  AddressUserToSignInput,
  NetworkType,
  PublicKeyUserToSignInput,
  SignPsbtOptions,
  ToSignInput,
  UTXO
} from './shared/types';
import { checkAddressFlag } from './shared/utils';
import { UnspentOutput, txHelpers } from '@unisat/wallet-sdk';
import { publicKeyToAddress, scriptPkToAddress } from '@unisat/wallet-sdk/lib/address';
import { ECPair, bitcoin } from '@unisat/wallet-sdk/lib/bitcoin-core';
import { signMessageOfBIP322Simple } from '@unisat/wallet-sdk/lib/message';
import { toPsbtNetwork } from '@unisat/wallet-sdk/lib/network';
import { getAddressUtxoDust } from '@unisat/wallet-sdk/lib/transaction';
import { toXOnly } from '@unisat/wallet-sdk/lib/utils';

import { OpenApiService } from './service/openapi';

import { LocalWallet } from "@unisat/wallet-sdk/lib/wallet";

export type AccountAsset = {
  name: string;
  symbol: string;
  amount: string;
  value: string;
};

export class Wallet {
  openapi: OpenApiService = openapiService;
  wallet: LocalWallet;
  addressType: AddressType;
  networkType: NetworkType;

  constructor(WIF: string, addressType: AddressType, networkType: NetworkType) {
    this.addressType = addressType;
    this.networkType = networkType;
    this.wallet = new LocalWallet(WIF, addressType, networkType);

    this.setNetworkType(networkType);
    openapiService.setClientAddress(this.wallet.address, 0);
  };

  getAddressBalance = async (address: string) => {
    const data = await openapiService.getAddressBalance(address);
    return data;
  };

  getMultiAddressAssets = async (addresses: string) => {
    return openapiService.getMultiAddressAssets(addresses);
  };

  findGroupAssets = (groups: { type: number; address_arr: string[] }[]) => {
    return openapiService.findGroupAssets(groups);
  };

  getAddressHistory = async (address: string) => {
    // const data = await openapiService.getAddressRecentHistory(address);
    // preferenceService.updateAddressHistory(address, data);
    // return data;
    //   todo
  };

  getAddressInscriptions = async (address: string, cursor: number, size: number) => {
    const data = await openapiService.getAddressInscriptions(address, cursor, size);
    return data;
  };

  /* getAllAddresses = (keyring: WalletKeyring, index: number) => {
    const networkType = this.getNetworkType();
    const addresses: string[] = [];
    const _keyring = keyringService.keyrings[keyring.index];
    if (keyring.type === KEYRING_TYPE.HdKeyring) {
      const pathPubkey: { [path: string]: string } = {};
      ADDRESS_TYPES.filter((v) => v.displayIndex >= 0).forEach((v) => {
        let pubkey = pathPubkey[v.hdPath];
        if (!pubkey && _keyring.getAccountByHdPath) {
          pubkey = _keyring.getAccountByHdPath(v.hdPath, index);
        }
        const address = publicKeyToAddress(pubkey, v.value, networkType);
        addresses.push(address);
      });
    } else {
      ADDRESS_TYPES.filter((v) => v.displayIndex >= 0 && v.isUnisatLegacy === false).forEach((v) => {
        const pubkey = keyring.accounts[index].pubkey;
        const address = publicKeyToAddress(pubkey, v.value, networkType);
        addresses.push(address);
      });
    }
    return addresses;
  }; */

  signTransaction = async (psbt: bitcoin.Psbt, inputs: ToSignInput[]) => {
    return this.wallet.keyring.signTransaction(psbt, inputs);
  };

  formatOptionsToSignInputs = async (_psbt: string | bitcoin.Psbt, options?: SignPsbtOptions) => {

    let toSignInputs: ToSignInput[] = [];
    if (options && options.toSignInputs) {
      // We expect userToSignInputs objects to be similar to ToSignInput interface,
      // but we allow address to be specified in addition to publicKey for convenience.
      toSignInputs = options.toSignInputs.map((input) => {
        const index = Number(input.index);
        if (isNaN(index)) throw new Error('invalid index in toSignInput');

        if (!(input as AddressUserToSignInput).address && !(input as PublicKeyUserToSignInput).publicKey) {
          throw new Error('no address or public key in toSignInput');
        }

        if ((input as AddressUserToSignInput).address && (input as AddressUserToSignInput).address != this.wallet.address) {
          throw new Error('invalid address in toSignInput');
        }

        if (
          (input as PublicKeyUserToSignInput).publicKey &&
          (input as PublicKeyUserToSignInput).publicKey != this.wallet.pubkey
        ) {
          throw new Error('invalid public key in toSignInput');
        }

        const sighashTypes = input.sighashTypes?.map(Number);
        if (sighashTypes?.some(isNaN)) throw new Error('invalid sighash type in toSignInput');

        return {
          index,
          publicKey: this.wallet.pubkey,
          sighashTypes,
          disableTweakSigner: input.disableTweakSigner
        };
      });
    } else {
      const networkType = this.getNetworkType();
      const psbtNetwork = toPsbtNetwork(networkType);

      const psbt =
        typeof _psbt === 'string'
          ? bitcoin.Psbt.fromHex(_psbt as string, { network: psbtNetwork })
          : (_psbt as bitcoin.Psbt);
      psbt.data.inputs.forEach((v, index) => {
        let script: any = null;
        let value = 0;
        if (v.witnessUtxo) {
          script = v.witnessUtxo.script;
          value = v.witnessUtxo.value;
        } else if (v.nonWitnessUtxo) {
          const tx = bitcoin.Transaction.fromBuffer(v.nonWitnessUtxo);
          const output = tx.outs[psbt.txInputs[index].index];
          script = output.script;
          value = output.value;
        }
        const isSigned = v.finalScriptSig || v.finalScriptWitness;
        if (script && !isSigned) {
          const address = scriptPkToAddress(script, networkType);
          if (this.wallet.address === address) {
            toSignInputs.push({
              index,
              publicKey: this.wallet.pubkey,
              sighashTypes: v.sighashType ? [v.sighashType] : undefined
            });
          }
        }
      });
    }
    return toSignInputs;
  };

  signPsbt = async (psbt: bitcoin.Psbt, toSignInputs: ToSignInput[], autoFinalized: boolean) => {

    const networkType = this.getNetworkType();
    const psbtNetwork = toPsbtNetwork(networkType);

    if (!toSignInputs) {
      // Compatibility with legacy code.
      toSignInputs = await this.formatOptionsToSignInputs(psbt);
      if (autoFinalized !== false) autoFinalized = true;
    }
    psbt.data.inputs.forEach((v, index) => {
      const isNotSigned = !(v.finalScriptSig || v.finalScriptWitness);
      const isP2TR = this.addressType === AddressType.P2TR || this.addressType === AddressType.M44_P2TR;
      const lostInternalPubkey = !v.tapInternalKey;
      // Special measures taken for compatibility with certain applications.
      if (isNotSigned && isP2TR && lostInternalPubkey) {
        const tapInternalKey = toXOnly(Buffer.from(this.wallet.pubkey, 'hex'));
        const { output } = bitcoin.payments.p2tr({
          internalPubkey: tapInternalKey,
          network: psbtNetwork
        });
        if (v.witnessUtxo?.script.toString('hex') == output?.toString('hex')) {
          v.tapInternalKey = tapInternalKey;
        }
      }
    });
    psbt = await this.signTransaction(psbt, toSignInputs);
    if (autoFinalized) {
      toSignInputs.forEach((v) => {
        // psbt.validateSignaturesOfInput(v.index, validator);
        psbt.finalizeInput(v.index);
      });
    }
    return psbt;
  };

  signMessage = async (text: string) => {
    return this.wallet.keyring.signMessage(this.wallet.pubkey, text);
  };

  signBIP322Simple = async (text: string) => {
    const networkType = this.getNetworkType();
    return signMessageOfBIP322Simple({
      message: text,
      address: this.wallet.address,
      networkType,
      wallet: this as any
    });
  };

  signData = async (data: string, type: "ecdsa" | "schnorr" = 'ecdsa') => {
    return this.wallet.keyring.signData(this.wallet.pubkey, data, type);
  };

  listChainAssets = async (pubkeyAddress: string) => {
    const balance = await openapiService.getAddressBalance(pubkeyAddress);
    const assets: AccountAsset[] = [
      { name: COIN_NAME, symbol: COIN_SYMBOL, amount: balance.amount, value: balance.usd_value }
    ];
    return assets;
  };

  reportErrors = (error: string) => {
    console.error('report not implemented');
  };

  getNetworkType = () => {
    return this.networkType;
  };

  setNetworkType = async (networkType: NetworkType) => {
    if (networkType === NetworkType.MAINNET) {
      this.openapi.setHost(OPENAPI_URL_MAINNET);
    } else {
      this.openapi.setHost(OPENAPI_URL_TESTNET);
    }
  };

  getNetworkName = () => {
    return NETWORK_TYPES[this.networkType].name;
  };

  getBTCUtxos = async () => {

    let utxos = await openapiService.getBTCUtxos(this.wallet.address);

    if (checkAddressFlag(openapiService.addressFlag, AddressFlagType.CONFIRMED_UTXO_MODE)) {
      utxos = utxos.filter((v) => (v as any).height !== UNCONFIRMED_HEIGHT);
    }

    const btcUtxos = utxos.map((v) => {
      return {
        txid: v.txid,
        vout: v.vout,
        satoshis: v.satoshis,
        scriptPk: v.scriptPk,
        addressType: v.addressType,
        pubkey: this.wallet.pubkey,
        inscriptions: v.inscriptions,
        atomicals: v.atomicals
      };
    });
    return btcUtxos;
  };

  getUnavailableUtxos = async () => {
    const utxos = await openapiService.getUnavailableUtxos(this.wallet.address);
    const unavailableUtxos = utxos.map((v) => {
      return {
        txid: v.txid,
        vout: v.vout,
        satoshis: v.satoshis,
        scriptPk: v.scriptPk,
        addressType: v.addressType,
        pubkey: this.wallet.pubkey,
        inscriptions: v.inscriptions,
        atomicals: v.atomicals
      };
    });
    return unavailableUtxos;
  };

  getAssetUtxosAtomicalsFT = async (ticker: string) => {
    let arc20_utxos = await openapiService.getArc20Utxos(this.wallet.address, ticker);
    arc20_utxos = arc20_utxos.filter((v) => (v as any).spent == false);

    const assetUtxos = arc20_utxos.map((v) => {
      return Object.assign(v, { pubkey: this.wallet.pubkey });
    });
    return assetUtxos;
  };

  sendBTC = async ({
    to,
    amount,
    feeRate,
    enableRBF,
    btcUtxos,
    memo,
    memos
  }: {
    to: string;
    amount: number;
    feeRate: number;
    enableRBF: boolean;
    btcUtxos?: UnspentOutput[];
    memo?: string;
    memos?: string[];
  }) => {

    const networkType = this.getNetworkType();

    if (!btcUtxos) {
      btcUtxos = await this.getBTCUtxos();
    }

    if (btcUtxos.length == 0) {
      throw new Error('Insufficient balance.');
    }

    const { psbt, toSignInputs } = await txHelpers.sendBTC({
      btcUtxos: btcUtxos,
      tos: [{ address: to, satoshis: amount }],
      networkType,
      changeAddress: this.wallet.address,
      feeRate,
      enableRBF,
      memo,
      memos
    });

    this.setPsbtSignNonSegwitEnable(psbt, true);
    await this.signPsbt(psbt, toSignInputs, true);
    this.setPsbtSignNonSegwitEnable(psbt, false);
    return psbt.toHex();
  };

  sendAllBTC = async ({
    to,
    feeRate,
    enableRBF,
    btcUtxos
  }: {
    to: string;
    feeRate: number;
    enableRBF: boolean;
    btcUtxos?: UnspentOutput[];
  }) => {

    const networkType = this.getNetworkType();

    if (!btcUtxos) {
      btcUtxos = await this.getBTCUtxos();
    }

    if (btcUtxos.length == 0) {
      throw new Error('Insufficient balance.');
    }

    const { psbt, toSignInputs } = await txHelpers.sendAllBTC({
      btcUtxos: btcUtxos,
      toAddress: to,
      networkType,
      feeRate,
      enableRBF
    });

    this.setPsbtSignNonSegwitEnable(psbt, true);
    await this.signPsbt(psbt, toSignInputs, true);
    this.setPsbtSignNonSegwitEnable(psbt, false);
    return psbt.toHex();
  };

  sendOrdinalsInscription = async ({
    to,
    inscriptionId,
    feeRate,
    outputValue,
    enableRBF,
    btcUtxos
  }: {
    to: string;
    inscriptionId: string;
    feeRate: number;
    outputValue?: number;
    enableRBF: boolean;
    btcUtxos?: UnspentOutput[];
  }) => {

    const networkType = this.getNetworkType();

    const utxo = await openapiService.getInscriptionUtxo(inscriptionId);
    if (!utxo) {
      throw new Error('UTXO not found.');
    }

    // if (utxo.inscriptions.length > 1) {
    //   throw new Error('Multiple inscriptions are mixed together. Please split them first.');
    // }

    const assetUtxo = Object.assign(utxo, { pubkey: this.wallet.pubkey });

    if (!btcUtxos) {
      btcUtxos = await this.getBTCUtxos();
    }

    if (btcUtxos.length == 0) {
      throw new Error('Insufficient balance.');
    }

    const { psbt, toSignInputs } = await txHelpers.sendInscription({
      assetUtxo,
      btcUtxos,
      toAddress: to,
      networkType,
      changeAddress: this.wallet.address,
      feeRate,
      outputValue: outputValue || assetUtxo.satoshis,
      enableRBF,
      enableMixed: true
    });

    this.setPsbtSignNonSegwitEnable(psbt, true);
    await this.signPsbt(psbt, toSignInputs, true);
    this.setPsbtSignNonSegwitEnable(psbt, false);
    return psbt.toHex();
  };

  sendOrdinalsInscriptions = async ({
    to,
    inscriptionIds,
    feeRate,
    enableRBF,
    btcUtxos
  }: {
    to: string;
    inscriptionIds: string[];
    utxos: UTXO[];
    feeRate: number;
    enableRBF: boolean;
    btcUtxos?: UnspentOutput[];
  }) => {

    const networkType = this.getNetworkType();

    const inscription_utxos = await openapiService.getInscriptionUtxos(inscriptionIds);
    if (!inscription_utxos) {
      throw new Error('UTXO not found.');
    }

    if (inscription_utxos.find((v) => v.inscriptions.length > 1)) {
      throw new Error('Multiple inscriptions are mixed together. Please split them first.');
    }

    const assetUtxos = inscription_utxos.map((v) => {
      return Object.assign(v, { pubkey: this.wallet.pubkey });
    });

    const toDust = getAddressUtxoDust(to);

    assetUtxos.forEach((v) => {
      if (v.satoshis < toDust) {
        throw new Error('Unable to send inscriptions to this address in batches, please send them one by one.');
      }
    });

    if (!btcUtxos) {
      btcUtxos = await this.getBTCUtxos();
    }

    if (btcUtxos.length == 0) {
      throw new Error('Insufficient balance.');
    }

    const { psbt, toSignInputs } = await txHelpers.sendInscriptions({
      assetUtxos,
      btcUtxos,
      toAddress: to,
      networkType,
      changeAddress: this.wallet.address,
      feeRate,
      enableRBF
    });

    this.setPsbtSignNonSegwitEnable(psbt, true);
    await this.signPsbt(psbt, toSignInputs, true);
    this.setPsbtSignNonSegwitEnable(psbt, false);

    return psbt.toHex();
  };

  splitOrdinalsInscription = async ({
    inscriptionId,
    feeRate,
    outputValue,
    enableRBF,
    btcUtxos
  }: {
    to: string;
    inscriptionId: string;
    feeRate: number;
    outputValue: number;
    enableRBF: boolean;
    btcUtxos?: UnspentOutput[];
  }) => {

    const networkType = this.getNetworkType();

    const utxo = await openapiService.getInscriptionUtxo(inscriptionId);
    if (!utxo) {
      throw new Error('UTXO not found.');
    }

    const assetUtxo = Object.assign(utxo, { pubkey: this.wallet.pubkey });

    if (!btcUtxos) {
      btcUtxos = await this.getBTCUtxos();
    }

    const { psbt, toSignInputs, splitedCount } = await txHelpers.splitInscriptionUtxo({
      assetUtxo,
      btcUtxos,
      networkType,
      changeAddress: this.wallet.address,
      feeRate,
      enableRBF,
      outputValue
    });

    this.setPsbtSignNonSegwitEnable(psbt, true);
    await this.signPsbt(psbt, toSignInputs, true);
    this.setPsbtSignNonSegwitEnable(psbt, false);
    return {
      psbtHex: psbt.toHex(),
      splitedCount
    };
  };

  pushTx = async (rawtx: string) => {
    const txid = await this.openapi.pushTx(rawtx);
    return txid;
  };

  queryDomainInfo = async (domain: string) => {
    const data = await openapiService.getDomainInfo(domain);
    return data;
  };

  getInscriptionSummary = async () => {
    const data = await openapiService.getInscriptionSummary();
    return data;
  };

  getAppSummary = async () => {
    const data = await openapiService.getAppSummary();

    return data;
  };

  getAddressUtxo = async (address: string) => {
    const data = await openapiService.getBTCUtxos(address);
    return data;
  };

  getFeeSummary = async () => {
    return openapiService.getFeeSummary();
  };

  inscribeBRC20Transfer = (address: string, tick: string, amount: string, feeRate: number, outputValue: number) => {
    return openapiService.inscribeBRC20Transfer(address, tick, amount, feeRate, outputValue);
  };

  getInscribeResult = (orderId: string) => {
    return openapiService.getInscribeResult(orderId);
  };

  decodePsbt = (psbtHex: string, website: string) => {
    return openapiService.decodePsbt(psbtHex, website);
  };

  getBRC20List = async (address: string, currentPage: number, pageSize: number) => {
    const cursor = (currentPage - 1) * pageSize;
    const size = pageSize;

    const { total, list } = await openapiService.getBRC20List(address, cursor, size);

    return {
      currentPage,
      pageSize,
      total,
      list
    };
  };

  getBRC20List5Byte = async (address: string, currentPage: number, pageSize: number) => {
    const cursor = (currentPage - 1) * pageSize;
    const size = pageSize;
    const { total, list } = await openapiService.getBRC20List5Byte(address, cursor, size);

    return {
      currentPage,
      pageSize,
      total,
      list
    };
  };

  getAllInscriptionList = async (address: string, currentPage: number, pageSize: number) => {
    const cursor = (currentPage - 1) * pageSize;
    const size = pageSize;

    const { total, list } = await openapiService.getAddressInscriptions(address, cursor, size);

    return {
      currentPage,
      pageSize,
      total,
      list
    };
  };

  getBRC20Summary = async (address: string, ticker: string) => {
    const tokenSummary = await openapiService.getAddressTokenSummary(address, ticker);

    return tokenSummary;
  };

  getBRC20TransferableList = async (address: string, ticker: string, currentPage: number, pageSize: number) => {
    const cursor = (currentPage - 1) * pageSize;
    const size = pageSize;

    const { total, list } = await openapiService.getTokenTransferableList(address, ticker, cursor, size);

    return {
      currentPage,
      pageSize,
      total,
      list
    };
  };

  createMoonpayUrl = (address: string) => {
    return openapiService.createMoonpayUrl(address);
  };

  getWalletConfig = () => {
    return openapiService.getWalletConfig();
  };

  getInscriptionUtxoDetail = async (inscriptionId: string) => {
    const utxo = await openapiService.getInscriptionUtxoDetail(inscriptionId);
    if (!utxo) {
      throw new Error('UTXO not found.');
    }
    return utxo;
  };

  getUtxoByInscriptionId = async (inscriptionId: string) => {
    const utxo = await openapiService.getInscriptionUtxo(inscriptionId);
    if (!utxo) {
      throw new Error('UTXO not found.');
    }
    return utxo;
  };

  getInscriptionInfo = async (inscriptionId: string) => {
    const utxo = await openapiService.getInscriptionInfo(inscriptionId);
    if (!utxo) {
      throw new Error('Inscription not found.');
    }
    return utxo;
  };

  checkWebsite = (website: string) => {
    return openapiService.checkWebsite(website);
  };

  getArc20BalanceList = async (address: string, currentPage: number, pageSize: number) => {
    const cursor = (currentPage - 1) * pageSize;
    const size = pageSize;

    const { total, list } = await openapiService.getArc20BalanceList(address, cursor, size);

    return {
      currentPage,
      pageSize,
      total,
      list
    };
  };

  getOrdinalsInscriptions = async (address: string, currentPage: number, pageSize: number) => {
    const cursor = (currentPage - 1) * pageSize;
    const size = pageSize;

    const { total, list } = await openapiService.getOrdinalsInscriptions(address, cursor, size);
    return {
      currentPage,
      pageSize,
      total,
      list
    };
  };

  getAtomicalsNFTs = async (address: string, currentPage: number, pageSize: number) => {
    const cursor = (currentPage - 1) * pageSize;
    const size = pageSize;

    const { total, list } = await openapiService.getAtomicalsNFT(address, cursor, size);
    return {
      currentPage,
      pageSize,
      total,
      list
    };
  };

  sendAtomicalsNFT = async ({
    to,
    atomicalId,
    feeRate,
    enableRBF,
    btcUtxos
  }: {
    to: string;
    atomicalId: string;
    feeRate: number;
    enableRBF: boolean;
    btcUtxos?: UnspentOutput[];
  }) => {

    const networkType = this.getNetworkType();

    const utxo = await openapiService.getAtomicalsUtxo(atomicalId);
    if (!utxo) {
      throw new Error('UTXO not found.');
    }

    if (utxo.inscriptions.length > 1) {
      throw new Error('Multiple inscriptions are mixed together. Please split them first.');
    }

    const assetUtxo = Object.assign(utxo, { pubkey: this.wallet.pubkey });

    if (!btcUtxos) {
      btcUtxos = await this.getBTCUtxos();
    }

    if (btcUtxos.length == 0) {
      throw new Error('Insufficient balance.');
    }

    const { psbt, toSignInputs } = await txHelpers.sendAtomicalsNFT({
      assetUtxo,
      btcUtxos,
      toAddress: to,
      networkType,
      changeAddress: this.wallet.address,
      feeRate,
      enableRBF
    });

    this.setPsbtSignNonSegwitEnable(psbt, true);
    await this.signPsbt(psbt, toSignInputs, true);
    this.setPsbtSignNonSegwitEnable(psbt, false);
    return psbt.toHex();
  };

  sendAtomicalsFT = async ({
    to,
    ticker,
    amount,
    feeRate,
    enableRBF,
    btcUtxos,
    assetUtxos
  }: {
    to: string;
    ticker: string;
    amount: number;
    feeRate: number;
    enableRBF: boolean;
    btcUtxos?: UnspentOutput[];
    assetUtxos?: UnspentOutput[];
  }) => {

    const networkType = this.getNetworkType();

    if (!assetUtxos) {
      assetUtxos = await this.getAssetUtxosAtomicalsFT(ticker);
    }

    if (!btcUtxos) {
      btcUtxos = await this.getBTCUtxos();
    }

    const changeDust = getAddressUtxoDust(this.wallet.address);

    const _assetUtxos: UnspentOutput[] = [];
    let total = 0;
    let change = 0;
    for (let i = 0; i < assetUtxos.length; i++) {
      const v = assetUtxos[i];
      total += v.satoshis;
      _assetUtxos.push(v);
      if (total >= amount) {
        change = total - amount;
        if (change == 0 || change >= changeDust) {
          break;
        }
      }
    }
    if (change != 0 && change < changeDust) {
      throw new Error('The amount for change is too low, please adjust the sending amount.');
    }
    assetUtxos = _assetUtxos;

    const { psbt, toSignInputs } = await txHelpers.sendAtomicalsFT({
      assetUtxos,
      btcUtxos,
      toAddress: to,
      networkType,
      changeAddress: this.wallet.address,
      changeAssetAddress: this.wallet.address,
      feeRate,
      enableRBF,
      sendAmount: amount
    });

    this.setPsbtSignNonSegwitEnable(psbt, true);
    await this.signPsbt(psbt, toSignInputs, true);
    this.setPsbtSignNonSegwitEnable(psbt, false);

    return psbt.toHex();
  };

  getAddressSummary = async (address: string) => {
    const data = await openapiService.getAddressSummary(address);
    // preferenceService.updateAddressBalance(address, data);
    return data;
  };

  setPsbtSignNonSegwitEnable(psbt: bitcoin.Psbt, enabled: boolean) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    //@ts-ignore
    psbt.__CACHE.__UNSAFE_SIGN_NONSEGWIT = enabled;
  }

  getVersionDetail = (version: string) => {
    return openapiService.getVersionDetail(version);
  };

  getRunesList = async (address: string, currentPage: number, pageSize: number) => {
    const cursor = (currentPage - 1) * pageSize;
    const size = pageSize;
    const { total, list } = await openapiService.getRunesList(address, cursor, size);

    return {
      currentPage,
      pageSize,
      total,
      list
    };
  };

  getAssetUtxosRunes = async (runeid: string) => {
    const runes_utxos = await openapiService.getRunesUtxos(this.wallet.address, runeid);

    const assetUtxos = runes_utxos.map((v) => {
      return Object.assign(v, { pubkey: this.wallet.pubkey });
    });

    assetUtxos.forEach((v) => {
      v.inscriptions = [];
      v.atomicals = [];
    });
    return assetUtxos;
  };

  getAddressRunesTokenSummary = async (address: string, runeid: string) => {
    const tokenSummary = await openapiService.getAddressRunesTokenSummary(address, runeid);
    return tokenSummary;
  };

  sendRunes = async ({
    to,
    runeid,
    runeAmount,
    feeRate,
    enableRBF,
    btcUtxos,
    assetUtxos,
    outputValue
  }: {
    to: string;
    runeid: string;
    runeAmount: string;
    feeRate: number;
    enableRBF: boolean;
    btcUtxos?: UnspentOutput[];
    assetUtxos?: UnspentOutput[];
    outputValue: number;
  }) => {

    const networkType = this.getNetworkType();

    if (!assetUtxos) {
      assetUtxos = await this.getAssetUtxosRunes(runeid);
    }

    const _assetUtxos: UnspentOutput[] = [];
    let total = BigInt(0);
    for (let i = 0; i < assetUtxos.length; i++) {
      const v = assetUtxos[i];
      v.runes?.forEach((r) => {
        if (r.runeid == runeid) {
          total = total + BigInt(r.amount);
        }
      });
      _assetUtxos.push(v);
      if (total >= BigInt(runeAmount)) {
        break;
      }
    }
    assetUtxos = _assetUtxos;

    if (!btcUtxos) {
      btcUtxos = await this.getBTCUtxos();
    }

    const { psbt, toSignInputs } = await txHelpers.sendRunes({
      assetUtxos,
      assetAddress: this.wallet.address,
      btcUtxos,
      btcAddress: this.wallet.address,
      toAddress: to,
      networkType,
      feeRate,
      enableRBF,
      runeid,
      runeAmount,
      outputValue
    });

    this.setPsbtSignNonSegwitEnable(psbt, true);
    await this.signPsbt(psbt, toSignInputs, true);
    this.setPsbtSignNonSegwitEnable(psbt, false);

    return psbt.toHex();
  };
}
