/* eslint-disable no-unused-vars */
/* eslint-disable jest/valid-expect */
const { expect } = require("chai")
const { ethers } = require("hardhat")

const toWei = (num) => ethers.utils.parseEther(num.toString())
const fromWei = (num) => ethers.utils.formatEther(num)

describe("NFTMarketplace", () => {
  let deployer, addr1, addr2, nft, marketplace
  let feePercent = 1
  let URI = "sample URI"

  beforeEach(async () => {
    // Get the ContractFactories and Signers here
    const NFT = await ethers.getContractFactory("NFT")
    const Marketplace = await ethers.getContractFactory("Marketplace")

    // Get signers
    ;[deployer, addr1, addr2] = await ethers.getSigners()

    // Deploy contracts
    nft = await NFT.deploy()
    marketplace = await Marketplace.deploy(feePercent)
  })

  describe("Deployment", () => {
    it("Should track name and symbol of the nft collection", async () => {
      expect(await nft.name()).to.be.equal("DApp NFT")
      expect(await nft.symbol()).to.be.equal("DAPP")
    })

    it("Should track feeAccount and feePercentage of the marketplace", async () => {
      expect(await marketplace.feeAccount()).to.be.equal(deployer.address)
      expect(await marketplace.feePercent()).to.be.equal(feePercent)
    })
  })

  describe("Minting NFTs", () => {
    it("Should track each minted NFT", async () => {
      // addr1 mints an nft
      await nft.connect(addr1).mint(URI)
      expect(await nft.tokenCount()).to.be.equal(1)
      expect(await nft.balanceOf(addr1.address)).to.be.equal(1)
      expect(await nft.tokenURI(1)).to.be.equal(URI)
      // addr2 mints an nft
      await nft.connect(addr2).mint(URI)
      expect(await nft.tokenCount()).to.equal(2)
      expect(await nft.balanceOf(addr2.address)).to.equal(1)
      expect(await nft.tokenURI(2)).to.equal(URI)
    })
  })

  describe("Making marketplace items", () => {
    beforeEach(async () => {
      // addr1 mints and nft
      await nft.connect(addr1).mint(URI)
      // addr1 approves marketplae to spend nft
      await nft.connect(addr1).setApprovalForAll(marketplace.address, true)
    })
    it("Should track newly created item, transfer NFT from seller to marketplace and emit Offered event", async () => {
      // addr1 offers their nft at a price of 1 ether
      await expect(
        marketplace.connect(addr1).makeItem(nft.address, 1, toWei(1))
      )
        .to.emit(marketplace, "Offered")
        .withArgs(1, nft.address, 1, toWei(1), addr1.address)
      // Owner of NFT should now be the marketplace
      expect(await nft.ownerOf(1)).to.be.equal(marketplace.address)
      // Item count should now equal 1
      expect(await marketplace.itemCount()).to.be.equal(1)
      // Get item from items mapping then check fields to ensure they are correct
      const item = await marketplace.items(1)
      expect(item.itemId).to.be.equal(1)
      expect(item.nft).to.be.equal(nft.address)
      expect(item.tokenId).to.be.equal(1)
      expect(item.price).to.be.equal(toWei(1))
      expect(item.sold).to.be.equal(false)
    })

    it("Should fail if price is set to zero", async () => {
      await expect(
        marketplace.connect(addr1).makeItem(nft.address, 1, 0)
      ).to.be.revertedWith("Price must be greater than zero")
    })
  })

  describe("Purchasing marketplace items", () => {
    let price = 2
    let fee = (feePercent / 100) * price
    let totalPriceInWei
    beforeEach(async () => {
      // addr1 mints an nft
      await nft.connect(addr1).mint(URI)
      // addr1 approves marketplace to spend nft
      await nft.connect(addr1).setApprovalForAll(marketplace.address, true)
      // addr1 makes their nft a marketplace item.
      await marketplace.connect(addr1).makeItem(nft.address, 1, toWei(price))
    })
    it("Should update item as sold, pay seller, transfer NFT to buyer, charge fees and emit a Bough event", async () => {
      const sellerInitialEthBal = await addr1.getBalance()
      const feeAccountInitialEthBal = await deployer.getBalance()
      // fetch item total price (market fees + item price)
      totalPriceInWei = await marketplace.getTotalPrice(1)
      // addr2 purchases item.
      await expect(
        marketplace.connect(addr2).purchaseItem(1, { value: totalPriceInWei })
      )
        .to.emit(marketplace, "Bought")
        .withArgs(1, nft.address, 1, toWei(price), addr1.address, addr2.address)
      const sellerFinalEthBal = await addr1.getBalance()
      const feeAccountFinalEthBal = await deployer.getBalance()
      // Item should be marked as sold
      expect((await marketplace.items(1)).sold).to.be.equal(true)
      // Seller should receive payment for the price of the NFT sold
      expect(+fromWei(sellerFinalEthBal)).to.be.equal(
        +price + +fromWei(sellerInitialEthBal)
      )
      // feeAccount should receive fee
      expect(+fromWei(feeAccountFinalEthBal)).to.be.equal(
        +fee + +fromWei(feeAccountInitialEthBal)
      )

      // The buyer should now own the nft
      expect(await nft.ownerOf(1)).to.be.equal(addr2.address)
    })
    it("Should fail for invalid item ids, sold items and when not enoguht ether is paid", async () => {
      // fails for invalid item ids
      await expect(
        marketplace.connect(addr2).purchaseItem(2, { value: totalPriceInWei })
      ).to.be.revertedWith("item doesn't exist")
      await expect(
        marketplace.connect(addr2).purchaseItem(0, { value: totalPriceInWei })
      ).to.be.revertedWith("item doesn't exist")
      // Fails when not enough ether is paid with the transaction
      await expect(
        marketplace.connect(addr2).purchaseItem(1, { value: toWei(price) })
      ).to.be.revertedWith(
        "not enough ether to cover item price and market fee"
      )
      // addr2 purchase item 1
      await marketplace
        .connect(addr2)
        .purchaseItem(1, { value: totalPriceInWei })
      // deployer tries purchasing item 1 after its been sold
      await expect(
        marketplace
          .connect(deployer)
          .purchaseItem(1, { value: totalPriceInWei })
      ).to.be.revertedWith("item already sold")
    })
  })
})
