
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";
import { parseEther } from "viem";

const { viem } = await network.connect();

describe("Pair additional tests", function () {
  async function deployFixture() {
    const [deployer, alice] = await viem.getWalletClients();

    const tokenA = await viem.deployContract("Token", [
      "Token A",
      "AAA",
      parseEther("1000000"),
    ]);

    const tokenB = await viem.deployContract("Token", [
      "Token B",
      "BBB",
      parseEther("1000000"),
    ]);

    const tokenC = await viem.deployContract("Token", [
      "Token C",
      "CCC",
      parseEther("1000000"),
    ]);

    const pair = await viem.deployContract("Pair", [
      tokenA.address,
      tokenB.address,
    ]);

    await tokenA.write.transfer([
      alice.account.address,
      parseEther("100000"),
    ]);

    await tokenB.write.transfer([
      alice.account.address,
      parseEther("100000"),
    ]);

    for (const wallet of [deployer, alice]) {
      await tokenA.write.approve(
        [pair.address, parseEther("1000000")],
        { account: wallet.account },
      );

      await tokenB.write.approve(
        [pair.address, parseEther("1000000")],
        { account: wallet.account },
      );
    }

    return { pair, tokenA, tokenB, tokenC, deployer, alice };
  }

  it("locks minimum liquidity on first deposit", async function () {
    const { pair } = await deployFixture();

    await pair.write.addLiquidity([
      parseEther("1000"),
      parseEther("1000"),
    ]);

    const supply = await pair.read.totalSupply();
    const balance = await pair.read.balanceOf([
      (await viem.getWalletClients())[0].account.address,
    ]);

    assert.equal(supply - balance, 1000n);
  });

  it("allows subsequent liquidity deposits proportionally", async function () {
    const { pair, alice } = await deployFixture();

    await pair.write.addLiquidity([
      parseEther("1000"),
      parseEther("1000"),
    ]);

    const supplyBefore = await pair.read.totalSupply();
    const reserve0 = await pair.read.reserve0();
    const reserve1 = await pair.read.reserve1();

    const amount0 = parseEther("100");
    const amount1 = parseEther("200");

    const expectedLiquidity = [
      (amount0 * supplyBefore) / reserve0,
      (amount1 * supplyBefore) / reserve1,
    ].reduce((a, b) => a < b ? a : b);

    await pair.write.addLiquidity(
      [amount0, amount1],
      { account: alice.account },
    );

    const aliceBalance = await pair.read.balanceOf([
      alice.account.address,
    ]);

    assert.equal(aliceBalance, expectedLiquidity);
    assert.equal(await pair.read.reserve0(), reserve0 + amount0);
    assert.equal(await pair.read.reserve1(), reserve1 + amount1);
  });

  it("removes liquidity and returns proportional tokens", async function () {
    const { pair, tokenA, tokenB, alice } = await deployFixture();

    await pair.write.addLiquidity([
      parseEther("1000"),
      parseEther("1000"),
    ]);

    await pair.write.addLiquidity(
      [parseEther("100"), parseEther("100")],
      { account: alice.account },
    );

    const liquidity = await pair.read.balanceOf([
      alice.account.address,
    ]);

    const supply = await pair.read.totalSupply();
    const reserve0 = await pair.read.reserve0();
    const reserve1 = await pair.read.reserve1();

    const expected0 = (liquidity * reserve0) / supply;
    const expected1 = (liquidity * reserve1) / supply;

    const balance0Before = await tokenA.read.balanceOf([
      alice.account.address,
    ]);

    const balance1Before = await tokenB.read.balanceOf([
      alice.account.address,
    ]);

    await pair.write.removeLiquidity(
      [liquidity],
      { account: alice.account },
    );

    const balance0After = await tokenA.read.balanceOf([
      alice.account.address,
    ]);

    const balance1After = await tokenB.read.balanceOf([
      alice.account.address,
    ]);

    assert.equal(balance0After - balance0Before, expected0);
    assert.equal(balance1After - balance1Before, expected1);

    assert.equal(
      await pair.read.balanceOf([alice.account.address]),
      0n,
    );
  });

  it("rejects swaps below minimum output", async function () {
    const { pair, tokenA, alice } = await deployFixture();

    await pair.write.addLiquidity([
      parseEther("1000"),
      parseEther("1000"),
    ]);

    const amountIn = parseEther("10");

    const expectedOut = await pair.read.getAmountOut([
      amountIn,
      await pair.read.reserve0(),
      await pair.read.reserve1(),
    ]);

    await assert.rejects(
      pair.write.swap(
        [tokenA.address, amountIn, expectedOut + 1n],
        { account: alice.account },
      ),
    );
  });

  it("rejects an invalid input token", async function () {
    const { pair, tokenC, alice } = await deployFixture();

    await pair.write.addLiquidity([
      parseEther("1000"),
      parseEther("1000"),
    ]);

    await assert.rejects(
      pair.write.swap(
        [tokenC.address, parseEther("10"), 0n],
        { account: alice.account },
      ),
    );
  });

  it("rejects zero input amounts", async function () {
    const { pair } = await deployFixture();

    await assert.rejects(
      pair.read.getAmountOut([0n, 1000n, 1000n]),
    );

    await assert.rejects(
      pair.write.addLiquidity([0n, parseEther("10")]),
    );
  });

  it("rejects swaps when liquidity is insufficient", async function () {
    const { pair } = await deployFixture();

    await assert.rejects(
      pair.read.getAmountOut([parseEther("10"), 0n, 1000n]),
    );
  });

  it("rejects zero liquidity removal", async function () {
    const { pair } = await deployFixture();

    await assert.rejects(
      pair.write.removeLiquidity([0n]),
    );
  });

  it("supports swaps in the reverse direction (token B to token A)", async function () {
    const { pair, tokenB, alice } = await deployFixture();

    await pair.write.addLiquidity([
      parseEther("1000"),
      parseEther("1000"),
    ]);

    const reserve0Before = await pair.read.reserve0();
    const reserve1Before = await pair.read.reserve1();
    const kBefore = reserve0Before * reserve1Before;
    const amountIn = parseEther("100");

    const expectedOut = await pair.read.getAmountOut([
      amountIn,
      reserve1Before,
      reserve0Before,
    ]);

    await pair.write.swap(
      [tokenB.address, amountIn, expectedOut],
      { account: alice.account },
    );

    assert.equal(
      await pair.read.reserve1(),
      reserve1Before + amountIn,
    );
    const reserve0After = await pair.read.reserve0();
const reserve1After = await pair.read.reserve1();

assert.ok(
  reserve0After * reserve1After >= kBefore,
  "k must not decrease in reverse swaps",
);

    assert.equal(
      await pair.read.reserve0(),
      reserve0Before - expectedOut,
    );
  });

  it("keeps reserves synchronized with actual token balances after swaps", async function () {
    const { pair, tokenA, tokenB, alice } = await deployFixture();

    await pair.write.addLiquidity([
      parseEther("1000"),
      parseEther("1000"),
    ]);

    await pair.write.swap(
      [tokenA.address, parseEther("50"), 0n],
      { account: alice.account },
    );

    const balance0 = await tokenA.read.balanceOf([pair.address]);
    const balance1 = await tokenB.read.balanceOf([pair.address]);

    assert.equal(await pair.read.reserve0(), balance0);
    assert.equal(await pair.read.reserve1(), balance1);
  });

  it("keeps reserves synchronized after liquidity removal", async function () {
    const { pair, tokenA, tokenB, alice } = await deployFixture();

    await pair.write.addLiquidity([
      parseEther("1000"),
      parseEther("1000"),
    ]);

    await pair.write.addLiquidity(
      [parseEther("100"), parseEther("100")],
      { account: alice.account },
    );

    const liquidity = await pair.read.balanceOf([
      alice.account.address,
    ]);

    await pair.write.removeLiquidity(
      [liquidity],
      { account: alice.account },
    );

    const balance0 = await tokenA.read.balanceOf([pair.address]);
    const balance1 = await tokenB.read.balanceOf([pair.address]);

    assert.equal(await pair.read.reserve0(), balance0);
    assert.equal(await pair.read.reserve1(), balance1);
  });

});
