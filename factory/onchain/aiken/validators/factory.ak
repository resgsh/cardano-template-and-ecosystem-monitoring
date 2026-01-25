use aiken/crypto.{VerificationKeyHash}
use cardano/assets.{PolicyId}
use cardano/transaction.{OutputReference, Transaction}
use cardano/value.{Value}
use cocktail/vodka_extra_signatories.{key_signed}
use cocktail/vodka_mints.{token_minted}

pub type FactoryDatum {
  products: List<ScriptHash>,
}

pub type FactoryRedeemer {
  CreateProduct { product_policy: PolicyId, product_name: ByteArray }
}

validator factory(owner: VerificationKeyHash, factory_marker_policy: PolicyId) {
  mint(redeemer: FactoryRedeemer, policy_id: PolicyId, tx: Transaction) {
    let CreateProduct { product_policy, product_name } = redeemer

    let owner_signed = key_signed(tx.extra_signatories, owner)

    let factory_spent =
      tx.inputs
        |> List.any(
            fn(i) {
              Value.has(i.value, factory_marker_policy, FACTORY_MARKER_NAME, 1)
            },
          )

    let product_minted = token_minted(tx.mint, product_policy, product_name, 1)

    owner_signed && factory_spent && product_minted
  }

  spend(
    datum: FactoryDatum,
    redeemer: FactoryRedeemer,
    _utxo: OutputReference,
    tx: Transaction,
  ) {
    let CreateProduct { product_policy, product_name } = redeemer

    // Marker token continuity
    let input_has_marker =
      tx.inputs
        |> List.any(
            fn(i) {
              Value.has(i.value, factory_marker_policy, "FACTORY_MARKER", 1)
            },
          )
    expect Some(own_input) = find_input(inputs, spent_output_ref)
    let Output { value: own_input_value, address: script_address, .. } =
      own_input.output

    let output_has_marker =
      tx.outputs
        |> List.any(
            fn(o) {
              Value.has(o.value, factory_marker_policy, "FACTORY_MARKER", 1)
            },
          )

    // Was a product minted?
    let product_minted = Value.has(tx.mint, product_policy, product_name, 1)

    let expected_products = datum.products + +
    [ProductRef { product_policy, product_name }]

    let datum_updated_correctly =
      if product_minted {
        tx.outputs
          |> List.any(
              fn(o) { o.datum == FactoryDatum { products: expected_products } },
            )
      } else {
        true
      }

    input_has_marker && output_has_marker && datum_updated_correctly
  }

  else(_) {
    fail
  }
}
