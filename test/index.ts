import assert from "assert";
import { expect } from "chai";
import { ethers, network } from "hardhat";
import { DoomsdayBounty, IDoomsday, MockHunter } from "../typechain";
import { formatEther, isAddress, parseEther } from "ethers/lib/utils";
import { Doomsday, findClosest, findWinningStrategy, IBunker } from "./game";

const PIN_BLOCK = 14200400;
const DOOMSDAY = "0xd6e382aa7A09fc4A09C2fb99Cfce6A429985E65d";
const DAO_ADDRESS = "0x7BB7bd0e8923B1f698eeaf0AB49834B8f1810d58";
const OWNER_ADDRESS = "0xaFA33991B1a03B0f79351439457059150cd6DdC0";

const NO_FUNDS_ADDRESS = "0x39355a7b5F15361582e55852af9C6b061bA4c10d";

const IMPACT_BLOCK_INTERVAL = 120;

const bunkerData: [number, number, number][] = [
  [66, -1883138, -879483],
  [122, 963858, -324191],
  [189, 474468, 272379],
  [485, -1167141, -619622],
  [502, 121328, -853287],
  [511, -1256300, -674025],
  [545, -148311, -528106],
  [547, 2016929, 542005],
  [602, -1377821, -644268],
  [617, 1460174, -892087],
  [631, 1194702, -236784],
  [663, 1241677, -518927],
  [673, 1183622, -299150],
  [702, -222516, -375272],
  [736, -904642, 659664],
  [791, 432336, -810105],
  [850, -1260104, -717447],
  [939, 1057106, -284012],
  [1036, 1328522, -445093],
  [1071, -1262475, -542059],
  [1140, 1056770, -316076],
  [1236, -925425, 742600],
  [1240, -961774, 723993],
  [1264, 390680, -928371],
  [1305, 341884, -377280],
  [1352, -1268603, -801711],
];
const bunkerCoords = new Map<number, [bigint, bigint]>();
for (const [tokenId, x, y] of bunkerData) {
  bunkerCoords.set(tokenId, [BigInt(x), BigInt(y)]);
}

describe("DoomsdayBounty", function () {
  beforeEach(async function () {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.MAINNET_URL,
            blockNumber: PIN_BLOCK,
          },
        },
      ],
    });
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [DAO_ADDRESS],
    });
  });

  it("DAO should win", async function () {
    const DAO = await ethers.provider.getSigner(DAO_ADDRESS);

    let doomsday = (await ethers.getContractAt(
      "IDoomsday",
      DOOMSDAY
    )) as any as IDoomsday;
    const totalSupply = (await doomsday.totalSupply()).toNumber();
    const bunkers = new Map<number, IBunker>();
    for (const [tokenId, x, y] of bunkerData) {
      const owner = await doomsday.ownerOf(tokenId);
      const [reinforcement, damage, lastImpact] =
        await doomsday.getStructuralData(tokenId);
      bunkers.set(tokenId, {
        tokenId,
        owner,
        x: BigInt(x),
        y: BigInt(y),
        reinforcement,
        damage,
        lastImpact,
      });
    }
    const bountyBlock = PIN_BLOCK + 4;
    const eliminationBlock =
      bountyBlock - (bountyBlock % IMPACT_BLOCK_INTERVAL) - 5;
    const hash = BigInt(
      (await ethers.provider.getBlock(eliminationBlock)).hash
    );

    const game = new Doomsday(bunkers, hash);
    const tokenToKeep = findClosest(
      game,
      game.currentImpact(),
      (tokenId, bunker) => {
        return bunker.owner !== DAO_ADDRESS;
      }
    );
    expect(tokenToKeep).to.be.greaterThan(0);
    console.log(`Keeping ${tokenToKeep}`);

    // NO_FUNDS account does not have funds to perform evac, so send them something
    await DAO.sendTransaction({
      to: NO_FUNDS_ADDRESS,
      value: parseEther("0.1"),
    });

    // owner withdraws their cut
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [OWNER_ADDRESS],
    });
    {
      doomsday = doomsday.connect(
        await ethers.provider.getSigner(OWNER_ADDRESS)
      );
      const ownerBalanceBefore = await ethers.provider.getBalance(
        OWNER_ADDRESS
      );
      const tx = await doomsday.ownerWithdraw();
      const receipt = await tx.wait();
      const gasPayment = receipt.effectiveGasPrice.mul(receipt.gasUsed);
      const ownerBalanceAfter = await ethers.provider.getBalance(OWNER_ADDRESS);
      const ownerPayment = ownerBalanceAfter
        .sub(ownerBalanceBefore)
        .add(gasPayment);
      console.log("Owner payment", formatEther(ownerPayment));
    }

    await network.provider.send("evm_setAutomine", [false]);

    let evacuated = 0;
    for (const [, bunker] of bunkers) {
      if (bunker.owner !== DAO_ADDRESS && bunker.tokenId !== tokenToKeep) {
        // all players except player that owns "tokenToKeep" decided to evacuate
        await network.provider.request({
          method: "hardhat_impersonateAccount",
          params: [bunker.owner],
        });
        doomsday = doomsday.connect(
          await ethers.provider.getSigner(bunker.owner)
        );
        await doomsday.evacuate(bunker.tokenId, {
          gasLimit: 200000,
        });
        evacuated += 1;
        game.evacuate(bunker.tokenId);
      }
    }
    await network.provider.send("evm_setAutomine", [true]);
    await network.provider.send("evm_mine", []);
    expect(evacuated).to.be.greaterThan(0);
    const totalSupplyAfterEvacuation = (
      await doomsday.totalSupply()
    ).toNumber();
    expect(totalSupply - evacuated).to.equal(totalSupplyAfterEvacuation);
    expect(await ethers.provider.getBlockNumber()).to.equal(bountyBlock - 1);

    const strategy = findWinningStrategy(game, DAO_ADDRESS);
    console.log("strategy", strategy);
    expect(strategy.length).to.be.greaterThan(0);
    for (const { move, tokenId } of strategy) {
      if (move === "hit") {
        game.confirmHit(tokenId);
      } else if (move === "evacuate") {
        game.evacuate(tokenId);
      }
    }
    const winner = game.winner();
    assert(winner);
    expect(winner.owner).to.equal(DAO_ADDRESS);

    // DAO deploys bounty contract
    const DoomsdayBounty = await ethers.getContractFactory(
      "DoomsdayBounty",
      DAO
    );
    const doomsdayBounty =
      (await DoomsdayBounty.deploy()) as any as DoomsdayBounty;
    const doomsdayBountyAddress = (doomsdayBounty as any).address;
    expect(isAddress(doomsdayBountyAddress)).to.equal(true);
    // DAO allows bounty contract to transfer tokens
    doomsday = doomsday.connect(DAO);
    await doomsday.setApprovalForAll((doomsdayBounty as any).address, true);

    // hunter deploys hunter contract
    const [hunterEOA] = await ethers.getSigners();
    const MockHunter = await ethers.getContractFactory("MockHunter", hunterEOA);
    const mockHunter = (await MockHunter.deploy(
      doomsdayBountyAddress
    )) as any as MockHunter;
    const mockHunterAddress = (mockHunter as any).address;

    const daoBalanceBefore = await DAO.getBalance();
    const hunterBalanceBefore = await ethers.provider.getBalance(
      mockHunterAddress
    );
    const winnerId = game.winner().tokenId;
    await mockHunter.collectBounty(
      winnerId,
      strategy.map((step) => (step.move === "hit" ? step.tokenId : 0)),
      strategy.map((step) => (step.move === "evacuate" ? step.tokenId : 0)),
      strategy.map((step) => (step.move === "transfer" ? step.tokenId : 0))
    );
    const daoBalanceAfter = await DAO.getBalance();
    const hunterBalanceAfter = await ethers.provider.getBalance(
      mockHunterAddress
    );

    // expect that bounty contract owns a winner token
    expect(await doomsday.ownerOf(winnerId)).to.equal(doomsdayBountyAddress);
    const daoPayment = daoBalanceAfter.sub(daoBalanceBefore);
    const bountyPayment = hunterBalanceAfter.sub(hunterBalanceBefore);
    console.log("DAO payment", formatEther(daoPayment));
    console.log("Bounty payment", formatEther(bountyPayment));
    expect(daoPayment.gt(parseEther("100"))).to.equal(true);
    expect(bountyPayment.gt(parseEther("5"))).to.equal(true);

    const doomsdayBalanceAfter = await ethers.provider.getBalance(DOOMSDAY);
    console.log("Doomsday balance", formatEther(doomsdayBalanceAfter));
  });

  it("should be possible to transfer bunker out of contract back to DAO", async function () {
    const DAO = await ethers.provider.getSigner(DAO_ADDRESS);

    // DAO deploys bounty contract
    const DoomsdayBounty = await ethers.getContractFactory(
      "DoomsdayBounty",
      DAO
    );
    let doomsdayBounty =
      (await DoomsdayBounty.deploy()) as any as DoomsdayBounty;
    const doomsdayBountyAddress = (doomsdayBounty as any).address;
    expect(isAddress(doomsdayBountyAddress)).to.equal(true);

    let doomsday = (await ethers.getContractAt(
      "IDoomsday",
      DOOMSDAY
    )) as any as IDoomsday;
    // find a non vulnerable bunker owned by DAO
    let bunkerId = 0;
    for (const [tokenId] of bunkerData) {
      if (!(await doomsday.isVulnerable(tokenId))) {
        const owner = await doomsday.ownerOf(tokenId);
        if (owner === DAO_ADDRESS) {
          bunkerId = tokenId;
          break;
        }
      }
    }
    expect(bunkerId).to.be.greaterThan(0);
    doomsday = doomsday.connect(DAO);

    // DAO transfer the bunker to bounty contract
    expect(await doomsday.ownerOf(bunkerId)).to.equal(DAO_ADDRESS);
    await doomsday.transferFrom(DAO_ADDRESS, doomsdayBountyAddress, bunkerId);
    expect(await doomsday.ownerOf(bunkerId)).to.equal(doomsdayBountyAddress);

    // anybody should be able to transfer the bunker back to DAO
    const [anybody] = await ethers.getSigners();
    doomsdayBounty = doomsdayBounty.connect(anybody);
    await doomsdayBounty.transferToDAO(bunkerId);
    expect(await doomsday.ownerOf(bunkerId)).to.equal(DAO_ADDRESS);
  });

  it("should NOT be possible to evacuate or transfer bunker outside of a bounty hunt", async function () {
    const DAO = await ethers.provider.getSigner(DAO_ADDRESS);

    // DAO deploys bounty contract
    const DoomsdayBounty = await ethers.getContractFactory(
      "DoomsdayBounty",
      DAO
    );
    let doomsdayBounty =
      (await DoomsdayBounty.deploy()) as any as DoomsdayBounty;
    const doomsdayBountyAddress = (doomsdayBounty as any).address;
    expect(isAddress(doomsdayBountyAddress)).to.equal(true);

    let doomsday = (await ethers.getContractAt(
      "IDoomsday",
      DOOMSDAY
    )) as any as IDoomsday;
    // find a non vulnerable bunker owned by DAO
    let bunkerId = 0;
    for (const [tokenId] of bunkerData) {
      if (!(await doomsday.isVulnerable(tokenId))) {
        const owner = await doomsday.ownerOf(tokenId);
        if (owner === DAO_ADDRESS) {
          bunkerId = tokenId;
          break;
        }
      }
    }
    expect(bunkerId).to.be.greaterThan(0);
    doomsday = doomsday.connect(DAO);

    // nobody should be able to simply evacuate a bunker
    expect(await doomsday.ownerOf(bunkerId)).to.equal(DAO_ADDRESS);
    const [anybody] = await ethers.getSigners();
    doomsdayBounty = doomsdayBounty.connect(anybody);
    try {
      await doomsdayBounty.evacuate(bunkerId);
      expect.fail("the transaction should fail");
    } catch (e: any) {
      expect(e.message).to.contain("not hunting");
    }
    expect(await doomsday.ownerOf(bunkerId)).to.equal(DAO_ADDRESS);

    // nobody should be able to simply transfer a bunker to a contract
    try {
      await doomsdayBounty.transferToSelf(bunkerId);
      expect.fail("the transaction should fail");
    } catch (e: any) {
      expect(e.message).to.contain("not hunting");
    }
    expect(await doomsday.ownerOf(bunkerId)).to.equal(DAO_ADDRESS);
  });

  it("only DAO should be able to set a bounty fee", async function () {
    const DAO = await ethers.provider.getSigner(DAO_ADDRESS);

    // DAO deploys bounty contract
    const DoomsdayBounty = await ethers.getContractFactory(
      "DoomsdayBounty",
      DAO
    );
    let doomsdayBounty =
      (await DoomsdayBounty.deploy()) as any as DoomsdayBounty;
    const doomsdayBountyAddress = (doomsdayBounty as any).address;
    expect(isAddress(doomsdayBountyAddress)).to.equal(true);

    expect(await doomsdayBounty.bountyFee()).to.equal(50);

    // nobody except DAO should be able to set a bounty fee
    const [anybody] = await ethers.getSigners();
    doomsdayBounty = doomsdayBounty.connect(anybody);
    try {
      await doomsdayBounty.setBountyFee(90);
      expect.fail("the transaction should fail");
    } catch (e: any) {
      expect(e.message).to.contain("not DAO");
    }
    expect(await doomsdayBounty.bountyFee()).to.equal(50);

    // DAO should NOT be able to set a large bounty fee
    doomsdayBounty = doomsdayBounty.connect(DAO);
    try {
      await doomsdayBounty.setBountyFee(110);
      expect.fail("the transaction should fail");
    } catch (e: any) {
      expect(e.message).to.contain("too generous");
    }
    expect(await doomsdayBounty.bountyFee()).to.equal(50);

    // DAO should be able to set a zero fee
    doomsdayBounty = doomsdayBounty.connect(DAO);
    await doomsdayBounty.setBountyFee(0);
    expect(await doomsdayBounty.bountyFee()).to.equal(0);

    // DAO should be able to set a larger fee
    doomsdayBounty = doomsdayBounty.connect(DAO);
    await doomsdayBounty.setBountyFee(90);
    expect(await doomsdayBounty.bountyFee()).to.equal(90);
  });

  it("only DAO should be able to withdraw from a bounty contract", async function () {
    const DAO = await ethers.provider.getSigner(DAO_ADDRESS);

    // DAO deploys bounty contract
    const DoomsdayBounty = await ethers.getContractFactory(
      "DoomsdayBounty",
      DAO
    );
    let doomsdayBounty =
      (await DoomsdayBounty.deploy()) as any as DoomsdayBounty;
    const doomsdayBountyAddress = (doomsdayBounty as any).address;
    expect(isAddress(doomsdayBountyAddress)).to.equal(true);

    // transfer some ETH into the contract
    const donation = parseEther("10");
    const [anybody] = await ethers.getSigners();
    await anybody.sendTransaction({
      to: doomsdayBountyAddress,
      value: donation,
    });
    {
      const doomsdayBountyBalance = await ethers.provider.getBalance(
        doomsdayBountyAddress
      );
      expect(doomsdayBountyBalance.toBigInt()).to.equal(donation.toBigInt());
    }

    // nobody except DAO should be able to withdraw
    doomsdayBounty = doomsdayBounty.connect(anybody);
    try {
      await doomsdayBounty.withdraw(donation);
      expect.fail("the transaction should fail");
    } catch (e: any) {
      expect(e.message).to.contain("not DAO");
    }
    {
      const doomsdayBountyBalance = await ethers.provider.getBalance(
        doomsdayBountyAddress
      );
      expect(doomsdayBountyBalance.toBigInt()).to.equal(donation.toBigInt());
    }

    // DAO should be able to withdraw everything
    doomsdayBounty = doomsdayBounty.connect(DAO);
    const balanceBeforeWithdraw = await DAO.getBalance();
    const tx = await doomsdayBounty.withdraw(donation);
    {
      const doomsdayBountyBalance = await ethers.provider.getBalance(
        doomsdayBountyAddress
      );
      expect(doomsdayBountyBalance).to.equal(0);
    }
    const balanceAfterWithdraw = await DAO.getBalance();
    const receipt = await tx.wait();
    const gasCost = receipt.effectiveGasPrice.mul(receipt.gasUsed);
    const payment = balanceAfterWithdraw
      .sub(balanceBeforeWithdraw)
      .add(gasCost);
    expect(payment.toBigInt()).to.equal(donation.toBigInt());
  });

  it("only DAO should be able to make arbitrary calls and send ETH out of the contract", async function () {
    const DAO = await ethers.provider.getSigner(DAO_ADDRESS);

    // DAO deploys bounty contract
    const DoomsdayBounty = await ethers.getContractFactory(
      "DoomsdayBounty",
      DAO
    );
    let doomsdayBounty =
      (await DoomsdayBounty.deploy()) as any as DoomsdayBounty;
    const doomsdayBountyAddress = (doomsdayBounty as any).address;
    expect(isAddress(doomsdayBountyAddress)).to.equal(true);

    // transfer some ETH into the contract
    const donation = parseEther("10");
    const [anybody] = await ethers.getSigners();
    await anybody.sendTransaction({
      to: doomsdayBountyAddress,
      value: donation,
    });
    {
      const doomsdayBountyBalance = await ethers.provider.getBalance(
        doomsdayBountyAddress
      );
      expect(doomsdayBountyBalance.toBigInt()).to.equal(donation.toBigInt());
    }

    // nobody except DAO should be able to make an arbitrary call
    doomsdayBounty = doomsdayBounty.connect(anybody);
    try {
      await doomsdayBounty.execute(anybody.address, donation, "0x");
      expect.fail("the transaction should fail");
    } catch (e: any) {
      expect(e.message).to.contain("not DAO");
    }
    {
      const doomsdayBountyBalance = await ethers.provider.getBalance(
        doomsdayBountyAddress
      );
      expect(doomsdayBountyBalance.toBigInt()).to.equal(donation.toBigInt());
    }

    // DAO should be able to make an arbitrary call and send funds to anybody
    doomsdayBounty = doomsdayBounty.connect(DAO);
    const balanceBeforeWithdraw = await anybody.getBalance();
    await doomsdayBounty.execute(anybody.address, donation, "0x");
    {
      const doomsdayBountyBalance = await ethers.provider.getBalance(
        doomsdayBountyAddress
      );
      expect(doomsdayBountyBalance).to.equal(0);
    }
    const balanceAfterWithdraw = await anybody.getBalance();
    const payment = balanceAfterWithdraw.sub(balanceBeforeWithdraw);
    expect(payment.toBigInt()).to.equal(donation.toBigInt());
  });

  it("only DAO should be able to make arbitrary calls and send NFT out of the contract", async function () {
    const DAO = await ethers.provider.getSigner(DAO_ADDRESS);

    // DAO deploys bounty contract
    const DoomsdayBounty = await ethers.getContractFactory(
      "DoomsdayBounty",
      DAO
    );
    let doomsdayBounty =
      (await DoomsdayBounty.deploy()) as any as DoomsdayBounty;
    const doomsdayBountyAddress = (doomsdayBounty as any).address;
    expect(isAddress(doomsdayBountyAddress)).to.equal(true);

    let doomsday = (await ethers.getContractAt(
      "IDoomsday",
      DOOMSDAY
    )) as any as IDoomsday;
    // find a non vulnerable bunker owned by DAO
    let bunkerId = 0;
    for (const [tokenId] of bunkerData) {
      if (!(await doomsday.isVulnerable(tokenId))) {
        const owner = await doomsday.ownerOf(tokenId);
        if (owner === DAO_ADDRESS) {
          bunkerId = tokenId;
          break;
        }
      }
    }
    expect(bunkerId).to.be.greaterThan(0);
    doomsday = doomsday.connect(DAO);
    await doomsday.transferFrom(DAO_ADDRESS, doomsdayBountyAddress, bunkerId);
    expect(await doomsday.ownerOf(bunkerId)).to.equal(doomsdayBountyAddress);

    // nobody except DAO should be able to make an arbitrary call and transfer NFT
    const [anybody] = await ethers.getSigners();
    const payload = doomsday.interface.encodeFunctionData("transferFrom", [
      doomsdayBountyAddress,
      anybody.address,
      bunkerId,
    ]);
    doomsdayBounty = doomsdayBounty.connect(anybody);
    try {
      await doomsdayBounty.execute(DOOMSDAY, 0, payload);
      expect.fail("the transaction should fail");
    } catch (e: any) {
      expect(e.message).to.contain("not DAO");
    }
    expect(await doomsday.ownerOf(bunkerId)).to.equal(doomsdayBountyAddress);

    // DAO should be able to make an arbitrary call and transfer NFT to anybody
    doomsdayBounty = doomsdayBounty.connect(DAO);
    await doomsdayBounty.execute(DOOMSDAY, 0, payload);
    expect(await doomsday.ownerOf(bunkerId)).to.equal(anybody.address);
  });
});
