import {
  scriptHash,  outputReference,  builtinByteString,
  deserializeDatum,
  hexToString,
  KoiosProvider,
  mConStr0,
  MeshTxBuilder,
  MeshWallet,
  resolvePaymentKeyHash,
  resolveScriptHash,
  serializePlutusScript,UTxO,
  stringToHex,
} from '@meshsdk/core';

import { applyParamsToScript } from '@meshsdk/core-csl';

import blueprint from '../../onchain/aiken/plutus.json' with { type: 'json' };

// ------------------------------------------------------------
// Config
// ------------------------------------------------------------

const NETWORK = 'preprod';
const NETWORK_ID = 0;
const FACTORY_MARKER_NAME_HEX = stringToHex('FACTORY_MARKER');

// ------------------------------------------------------------
// Wallet helper
// ------------------------------------------------------------

function loadWalletFromFile(path: string): MeshWallet {
  const mnemonic = JSON.parse(Deno.readTextFileSync(path));
  const provider = new KoiosProvider(NETWORK);

  return new MeshWallet({
    networkId: NETWORK_ID,
    fetcher: provider,
    submitter: provider,
    key: { type: 'mnemonic', words: mnemonic },
  });
}

// ------------------------------------------------------------
// Script helpers
// ------------------------------------------------------------

function getValidator(name: string) {
  const v = blueprint.validators.find(v => v.title.startsWith(name));
  if (!v) throw new Error(`Validator not found: ${name}`);
  return v.compiledCode;
}

function getScriptAddress(compiled: string) {
  const { address } = serializePlutusScript(
    { code: compiled, version: 'V3' },
    undefined,
    NETWORK_ID,
  );
  return address;
}

// ------------------------------------------------------------
// Factory scripts
// ------------------------------------------------------------

function getFactoryMarkerAndScriptDetails(ownerPkh: string,seedUtxo: UTxO) {


  const factoryMarkerScript = applyParamsToScript(
    getValidator('factory_marker.'),
    [builtinByteString(ownerPkh),
      outputReference(seedUtxo.input.txHash!, seedUtxo.input.outputIndex!)
    ],
    'JSON',
  );

  const factoryScript = applyParamsToScript(
    getValidator('factory.'),
    [builtinByteString(ownerPkh),
      scriptHash(resolveScriptHash(factoryMarkerScript, 'V3'))
    ],
    'JSON',
  );
  return {
    factory: {
      script: factoryScript,
      scriptHash: resolveScriptHash(factoryScript, 'V3'),
      address: getScriptAddress(factoryScript),
    },
    factoryMarker: {
      script: factoryMarkerScript,
      policyId: resolveScriptHash(factoryMarkerScript, 'V3'),
    },
  };
}
function getFactoryScriptDetails(ownerPkh: string,markerPolicyId: string) {

  const factoryScript = applyParamsToScript(
    getValidator('factory.'),
    [builtinByteString(ownerPkh),
      scriptHash(markerPolicyId)
    ],
    'JSON',
  );
  return {
    factory: {
      script: factoryScript,
      scriptHash: resolveScriptHash(factoryScript, 'V3'),
      address: getScriptAddress(factoryScript),
    },
  };
}

// ------------------------------------------------------------
// Product script
// ------------------------------------------------------------

function getProductScriptDetails(
  ownerPkh: string,
  productId: string,
) {
  const factory = getFactoryScriptDetails(ownerPkh);

  const script = applyParamsToScript(
    getValidator('product'),
    [
      builtinByteString(ownerPkh),
      builtinByteString(factory.factoryMarker.policyId), // _factory_id : PolicyId
      builtinByteString(stringToHex(productId)),
    ],
    'JSON',
  );

  return {
    script,
    address: getScriptAddress(script),
  };
}

// ------------------------------------------------------------
// 1. Create Factory (ONE TIME)
// ------------------------------------------------------------
export async function createFactory(walletFile: string) {
  const wallet = loadWalletFromFile(walletFile);
  const provider = new KoiosProvider(NETWORK);

  const changeAddr = await wallet.getChangeAddress();
  const ownerPkh = resolvePaymentKeyHash(changeAddr);

  const utxos = await provider.fetchAddressUTxOs(changeAddr);
  if (!utxos.length) throw new Error('No wallet UTxOs');

  const collateral = await wallet.getCollateral();
  const seedUtxo = utxos[0]; // one-shot seed

  const factory = getFactoryMarkerAndScriptDetails(ownerPkh, seedUtxo);

  const tx = new MeshTxBuilder({
    fetcher: provider,
    submitter: provider,
    evaluator: provider,
  }).setNetwork(NETWORK);

  await tx
    .txIn(
      seedUtxo.input.txHash,
      seedUtxo.input.outputIndex,
      seedUtxo.output.amount,
      seedUtxo.output.address,
    )

    // Mint FACTORY_MARKER
    .mintPlutusScriptV3()
    .mint('1', factory.factoryMarker.policyId, FACTORY_MARKER_NAME_HEX)
    .mintingScript(factory.factoryMarker.script)
    .mintRedeemerValue("")

    // Lock marker at factory script
    .txOut(
      factory.factory.address,
      [
        {
          unit:
            factory.factoryMarker.policyId + FACTORY_MARKER_NAME_HEX,
          quantity: '1',
        },
      ],
    )
    .txOutInlineDatumValue(
      mConStr0(([[]]))
    )

    // Signer & collateral
    .requiredSignerHash(ownerPkh)
    .txInCollateral(
      collateral[0].input.txHash,
      collateral[0].input.outputIndex,
      collateral[0].output.amount,
      collateral[0].output.address,
    )
    .changeAddress(changeAddr)
    .selectUtxosFrom(utxos)
    .complete();

  const signed = await wallet.signTx(tx.txHex);
  const hash = await wallet.submitTx(signed);

  console.log('Factory created');
  console.log('Owner PKH:', ownerPkh);
  console.log('Factory address:', factory.factory.address);
  console.log('Factory marker policy:', factory.factoryMarker.policyId);
  console.log('Tx hash:', hash);
}


// ------------------------------------------------------------
// 2. Create Product
// ------------------------------------------------------------

export async function createProduct(
  walletFile: string,
  productId: string,
  tag: string,
) {
  const wallet = loadWalletFromFile(walletFile);
  const provider = new KoiosProvider(NETWORK);

  const changeAddr = await wallet.getChangeAddress();
  const ownerPkh = resolvePaymentKeyHash(changeAddr);

  const factory = getFactoryScriptDetails(ownerPkh);
  const product = getProductScriptDetails(ownerPkh, productId);

  const utxos = await provider.fetchAddressUTxOs(changeAddr);
  const collateral = (await wallet.getCollateral())[0];

  const productDatum = mConStr0([stringToHex(tag)]);

  const tx = new MeshTxBuilder({
    fetcher: provider,
    submitter: provider,
    evaluator: provider,
  }).setNetwork(NETWORK);

  await tx
    // Spend factory UTxO (marker inside)
    .spendingPlutusScriptV3()
    .txIn(
      utxos[0].input.txHash,
      utxos[0].input.outputIndex,
      utxos[0].output.amount,
      factory.factory.address,
    )
    .txInInlineDatumPresent()
    .txInRedeemerValue(
      mConStr0([
        factory.factoryMarker.policyId,
        stringToHex(productId),
      ]),
      'JSON',
    )
    .txInScript(factory.factory.script)

    // Mint product NFT
    .mintPlutusScriptV3()
    .mint('1', factory.factory.scriptHash, stringToHex(productId))
    .mintingScript(factory.factory.script)
    .mintRedeemerValue(
      mConStr0([
        factory.factoryMarker.policyId,
        stringToHex(productId),
      ]),
    )

    // Product UTxO
    .txOut(
      product.address,
      [
        {
          unit:
            factory.factory.scriptHash + stringToHex(productId),
          quantity: '1',
        },
      ],
    )
    .txOutInlineDatumValue(productDatum)

    .requiredSignerHash(ownerPkh)
    .txInCollateral(
      collateral.input.txHash,
      collateral.input.outputIndex,
      collateral.output.amount,
      collateral.output.address,
    )
    .changeAddress(changeAddr)
    .selectUtxosFrom(utxos)
    .complete();

  const signed = await wallet.signTx(tx.txHex);
  const hash = await wallet.submitTx(signed);

  console.log('Product created');
  console.log('Product address:', product.address);
  console.log('Tx hash:', hash);
}

// ------------------------------------------------------------
// 3. Read helpers
// ------------------------------------------------------------

// ------------------------------------------------------------
// getProducts (derived from owner)
// ------------------------------------------------------------
export async function getProducts(ownerPkh: string) {
  const factory = getFactoryScriptDetails(ownerPkh);

  const productPolicyId = factory.factory.scriptHash;

  const url =
    `https://preprod.koios.rest/api/v1/policy_asset_list` +
    `?_asset_policy=${productPolicyId}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Koios error: ${response.statusText}`);
  }

  const assets = await response.json();

  const products = assets.map((asset: any) => ({
    productId: hexToString(asset.asset_name), // asset name → product id
    policyId: productPolicyId,
    fingerprint: asset.fingerprint,
  }));

  console.log('Products fetched:', products);
  return products;
}


export async function getTag(
  ownerPkh: string,
  productId: string,
) {
  const provider = new KoiosProvider(NETWORK);
  const product = getProductScriptDetails(ownerPkh, productId);

  const utxos = await provider.fetchAddressUTxOs(product.address);
  if (!utxos.length || !utxos[0].output.plutusData) {
    throw new Error('Product datum not found');
  }

  const datum = deserializeDatum(utxos[0].output.plutusData);
  return hexToString(datum.fields[0].bytes);
}

export async function getFactory(walletFile: string,markerPolicyId: string) {
  const wallet = loadWalletFromFile(walletFile);
  const provider = new KoiosProvider(NETWORK);

  const changeAddr = await wallet.getChangeAddress();
  const ownerPkh = resolvePaymentKeyHash(changeAddr);
  return getFactoryScriptDetails(ownerPkh, markerPolicyId);
}

// ------------------------------------------------------------
// CLI
// ------------------------------------------------------------

if (import.meta.main) {
  const [cmd, ...args] = Deno.args;

  switch (cmd) {
    case 'create-factory': {
      if (args.length !== 1) {
        console.log('Usage: create-factory <wallet.json> <txHash> <index>');
        Deno.exit(1);
      }
      const [wallet, txHash, index] = args;
      await createFactory(wallet);
      break;
    }

    case 'create-product': {
      if (args.length !== 3) {
        console.log('Usage: create-product <wallet.json> <product_id> <tag>');
        Deno.exit(1);
      }
      const [wallet, productId, tag] = args;
      await createProduct(wallet, productId, tag);
      break;
    }

    case 'get-products': {
      if (args.length !== 1) {
        console.log('Usage: get-products <owner_pkh>');
        Deno.exit(1);
      }
      const [ownerPkh] = args;
      await getProducts(ownerPkh);
      break;
    }

    case 'get-tag': {
      if (args.length !== 2) {
        console.log('Usage: get-tag <owner_pkh> <product_id>');
        Deno.exit(1);
      }
      const [ownerPkh, productId] = args;
      console.log(await getTag(ownerPkh, productId));
      break;
    }

    case 'get-factory': {
      if (args.length !== 2) {
        console.log('Usage: get-factory <wallet.json> <marker_policy_id>');
        Deno.exit(1);
      }
      const [ownerPkh,markerPolicyId] = args;
      console.log(await getFactory(ownerPkh,markerPolicyId));
      break;
    }

    default:
      console.log(`
Usage:
  create-factory <wallet.json> 
  create-product <wallet.json> <product_id> <tag>
  get-products <owner_pkh>
  get-tag <owner_pkh> <product_id>
  get-factory <owner_pkh>
`);
  }
}
