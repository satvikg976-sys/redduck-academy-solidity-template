
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract Pair is ERC20 {
    uint256 public constant MINIMUM_LIQUIDITY = 1000;

    IERC20 public immutable token0;
    IERC20 public immutable token1;

    uint256 public reserve0;
    uint256 public reserve1;

    error InsufficientLiquidity();
    error InsufficientAmount();
    error InsufficientOutput();
    error InvalidToken();

    event LiquidityAdded(address indexed who, uint256 amount0, uint256 amount1, uint256 liquidity);
    event LiquidityRemoved(address indexed who, uint256 amount0, uint256 amount1, uint256 liquidity);
    event Swapped(address indexed who, address indexed tokenIn, uint256 amountIn, uint256 amountOut);

    constructor(IERC20 _token0, IERC20 _token1) ERC20("Simple AMM LP", "sLP") {
        token0 = _token0;
        token1 = _token1;
    }

    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) public pure returns (uint256) {
        if (amountIn == 0) revert InsufficientAmount();
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();

        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * 1000 + amountInWithFee;

        return numerator / denominator;
    }

    function addLiquidity(
        uint256 amount0,
        uint256 amount1
    ) external returns (uint256 liquidity) {
        if (amount0 == 0 || amount1 == 0) revert InsufficientAmount();

        uint256 supply = totalSupply();

        require(token0.transferFrom(msg.sender, address(this), amount0), "TRANSFER_FROM_FAILED");
        require(token1.transferFrom(msg.sender, address(this), amount1), "TRANSFER_FROM_FAILED");

        if (supply == 0) {
            uint256 initialLiquidity = _sqrt(amount0 * amount1);

            if (initialLiquidity <= MINIMUM_LIQUIDITY) revert InsufficientLiquidity();

            liquidity = initialLiquidity - MINIMUM_LIQUIDITY;

            _mint(address(0xdead), MINIMUM_LIQUIDITY);
        } else {
            uint256 liquidity0 = (amount0 * supply) / reserve0;
            uint256 liquidity1 = (amount1 * supply) / reserve1;

            liquidity = _min(liquidity0, liquidity1);
        }

        if (liquidity == 0) revert InsufficientLiquidity();

        _mint(msg.sender, liquidity);

        reserve0 = token0.balanceOf(address(this));
        reserve1 = token1.balanceOf(address(this));

        emit LiquidityAdded(msg.sender, amount0, amount1, liquidity);
    }

    function removeLiquidity(
        uint256 liquidity
    ) external returns (uint256 amount0, uint256 amount1) {
        if (liquidity == 0) revert InsufficientAmount();

        uint256 supply = totalSupply();

        amount0 = (liquidity * reserve0) / supply;
        amount1 = (liquidity * reserve1) / supply;

        if (amount0 == 0 || amount1 == 0) revert InsufficientLiquidity();

        _burn(msg.sender, liquidity);

        require(token0.transfer(msg.sender, amount0), "TRANSFER_FAILED");
        require(token1.transfer(msg.sender, amount1), "TRANSFER_FAILED");

        reserve0 = token0.balanceOf(address(this));
        reserve1 = token1.balanceOf(address(this));

        emit LiquidityRemoved(msg.sender, amount0, amount1, liquidity);
    }

    function swap(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut
    ) external returns (uint256 amountOut) {
        uint256 reserveIn;
        uint256 reserveOut;
        IERC20 outputToken;

        if (tokenIn == address(token0)) {
            reserveIn = reserve0;
            reserveOut = reserve1;
            outputToken = token1;
        } else if (tokenIn == address(token1)) {
            reserveIn = reserve1;
            reserveOut = reserve0;
            outputToken = token0;
        } else {
            revert InvalidToken();
        }

        amountOut = getAmountOut(amountIn, reserveIn, reserveOut);

        if (amountOut < minAmountOut) revert InsufficientOutput();

        require(IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn), "TRANSFER_FROM_FAILED");
        require(outputToken.transfer(msg.sender, amountOut), "TRANSFER_FAILED");

        reserve0 = token0.balanceOf(address(this));
        reserve1 = token1.balanceOf(address(this));

        emit Swapped(msg.sender, tokenIn, amountIn, amountOut);
    }

    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}
