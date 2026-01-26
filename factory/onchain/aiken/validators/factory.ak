use aiken/collection/list
use aiken/crypto.{ScriptHash, VerificationKeyHash}
use cardano/assets.{PolicyId, Value, has_nft_strict}
use cardano/transaction.{InlineDatum, OutputReference, Transaction, find_input}
use cocktail/vodka_address.{address_script_hash}
use cocktail/vodka_extra_signatories.{key_signed}
use cocktail/vodka_inputs.{inputs_with}
use cocktail/vodka_mints.{only_minted_token, token_minted}
use cocktail/vodka_outputs.{outputs_at, outputs_with}

pub type FactoryDatum {
  products: List<ScriptHash>,
}

pub type FactoryRedeemer {
  CreateProduct { product_policy_id: ByteArray, product_id: ByteArray }
}

validator factory(owner: VerificationKeyHash, factory_marker_policy: PolicyId) {
  mint(redeemer: FactoryRedeemer, policy_id: PolicyId, tx: Transaction) {
    let Transaction { inputs, extra_signatories, mint, .. } = tx
    let CreateProduct { product_id, .. } = redeemer

    let product_minted = only_minted_token(mint, policy_id, product_id, 1)

    let factory_marker_spent =
      (
        inputs_with(inputs, factory_marker_policy, "FACTORY_MARKER")
          |> list.length
      ) == 1

    key_signed(extra_signatories, owner) && factory_marker_spent && product_minted
  }

  spend(
    _datum_opt: Option<FactoryDatum>,
    redeemer: FactoryRedeemer,
    oref: OutputReference,
    tx: Transaction,
  ) {
    let Transaction { inputs, outputs, extra_signatories, mint, .. } = tx

    let CreateProduct { product_policy_id, product_id } = redeemer

    expect Some(own_input) = find_input(inputs, oref)

    // Marker token continuity
    expect
      has_nft_strict(
        own_input.output.value,
        factory_marker_policy,
        "FACTORY_MARKER",
      )

    expect [continuing_output] =
      outputs
        |> outputs_at(own_input.output.address)
        |> outputs_with(factory_marker_policy, "FACTORY_MARKER")

    // Was a product minted?
    let product_minted =
      only_minted_token(mint, product_policy_id, product_id, 1)

    expect InlineDatum(raw_datum_new) = continuing_output.datum
    expect FactoryDatum { products } = raw_datum_new

    let datum_updated = list.has(products, product_policy_id)

    key_signed(extra_signatories, owner) && datum_updated && product_minted
  }

  else(_) {
    fail
  }
}
