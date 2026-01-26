use cardano/assets.{from_asset}
use cardano/transaction.{InlineDatum, Input, Output}
use factory.{CreateProduct, FactoryDatum, FactoryRedeemer}
use mocktail.{
  add_input, add_reference_input, complete, invalid_before, mint, mocktail_tx,
  required_signer_hash, tx_out, tx_out_inline_datum,
}
use mocktail/virgin_address.{mock_script_address}
use mocktail/virgin_key_hash.{
  mock_policy_id, mock_pub_key_hash, mock_script_hash,
}
use mocktail/virgin_output_reference.{mock_utxo_ref}

const owner_pkh = mock_pub_key_hash(0)

const attacker = mock_pub_key_hash(1)

const factory_script_hash = mock_script_hash(1)

const factory_script_addr = mock_script_address(1, None)

const product_script_hash = mock_script_hash(2)

const product_script_addr = mock_script_address(2, None)

const factory_marker_policy = mock_policy_id(0)

const product_policy = mock_policy_id(1)

const product_id = "PRODUCT_1"

const factory_marker_value =
  from_asset(factory_marker_policy, "FACTORY_MARKER", 1)

const marker_input =
  Input {
    output_reference: mock_utxo_ref(0, 0),
    output: Output {
      address: factory_script_addr,
      value: from_asset(factory_marker_policy, "FACTORY_MARKER", 1),
      datum: InlineDatum([]),
      reference_script: None,
    },
  }

test factory_create_product_valid() {
  let tx =
    mocktail_tx()
      |> required_signer_hash(True, owner_pkh)
      |> mint(True, 1, product_policy, product_id)
      |> complete()
      |> add_input(True, marker_input)

  factory.factory.mint(
    owner_pkh,
    factory_marker_policy,
    CreateProduct { product_policy_id: product_policy, product_id },
    product_policy,
    tx,
  )
}

test factory_create_product_wrong_signer() {
  let tx =
    mocktail_tx()
      |> required_signer_hash(True, attacker)
      |> mint(True, 1, product_policy, product_id)
      |> complete()
      |> add_input(True, marker_input)

  !factory.factory.mint(
    owner_pkh,
    factory_marker_policy,
    CreateProduct { product_policy_id: product_policy, product_id },
    product_policy,
    tx,
  )
}

test factory_create_product_wrong_quantity() {
  let tx =
    mocktail_tx()
      |> required_signer_hash(True, owner_pkh)
      |> mint(True, 2, product_policy, product_id)
      |> complete()
      |> add_input(True, marker_input)

  !factory.factory.mint(
    owner_pkh,
    factory_marker_policy,
    CreateProduct { product_policy_id: product_policy, product_id },
    product_policy,
    tx,
  )
}

test factory_spend_valid() {
  let new_datum = InlineDatum(FactoryDatum { products: [product_script_hash] })

  let tx =
    mocktail_tx()
      |> required_signer_hash(True, owner_pkh)
      |> tx_out(True, factory_script_addr, factory_marker_value)
      |> tx_out_inline_datum(True, new_datum)
      |> mint(True, 1, product_policy, product_id)
      |> complete()
      |> add_input(True, marker_input)

  factory.factory.spend(
    owner_pkh,
    factory_marker_policy,
    None,
    CreateProduct { product_policy_id: product_policy, product_id },
    marker_input.output_reference,
    tx,
  )
}

test factory_spend_without_mint_fails() {
    let new_datum = InlineDatum(FactoryDatum { products: [product_script_hash] })
    
  let tx =
    mocktail_tx()
      |> required_signer_hash(True, owner_pkh)
      |> tx_out(True, factory_script_addr, factory_marker_value)
      |> tx_out_inline_datum(True, new_datum)
      |> complete()
      |> add_input(True, marker_input)

  !factory.factory.spend(
    owner_pkh,
    factory_marker_policy,
    None,
    CreateProduct { product_policy_id: product_policy, product_id },
    marker_input.output_reference,
    tx,
  )
}
