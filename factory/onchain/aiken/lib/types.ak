use aiken/crypto.{ScriptHash}
use cardano/address.{Address}
use cardano/assets.{PolicyId}

pub type FactoryDatum {
  products: List<PolicyId>,
}

pub type ProductDatum {
  tag: ByteArray,
}
