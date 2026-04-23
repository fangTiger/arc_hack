import { expect, test } from '@playwright/test';

test('should complete a preset-driven analysis and support detail and graph overlays', async ({ page }) => {
  await page.goto('/demo/live');

  await expect(page.getByRole('heading', { name: '可信投研工作台' })).toBeVisible();

  await page.getByTestId('source-drawer-toggle').click();
  await page.getByTestId('preset-launch-panews-funding-round').click();

  await expect(page.locator('#overall-status')).toHaveText('分析完成');
  await expect(page.locator('#event-headline')).toContainText('PANews：某协议完成 5000 万美元融资');
  await expect(page.locator('.deep-reading-block')).toHaveCount(3);

  await page.getByTestId('judgment-card-0').click();
  await expect(page.locator('#detail-drawer')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('#detail-panel-title')).toContainText('初步归类');

  await page.locator('#detail-panel-close').click();
  await expect(page.locator('#detail-drawer')).toHaveAttribute('aria-hidden', 'true');

  await page.getByTestId('graph-expand-button').click();
  await expect(page.locator('#graph-modal')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('#graph-modal-preview .graph-modal-canvas, #graph-modal-preview .graph-list')).toBeVisible();
});

test('should retain the previous result until a slow re-run replaces it', async ({ page }) => {
  await page.goto('/demo/live');

  await page.getByTestId('source-drawer-toggle').click();
  await page.getByTestId('preset-launch-panews-funding-round').click();

  await expect(page.locator('#overall-status')).toHaveText('分析完成');
  await expect(page.getByTestId('judgment-card-0')).toContainText('初步归类为融资');

  await page.locator('#text-input').fill(
    [
      '某协议宣布推出支付清算新产品，并计划在下季度扩大机构服务覆盖。',
      '团队预计第三季度向机构客户开放内测。',
      '[e2e-slow]'
    ].join(' ')
  );
  await page.locator('#start-button').click();

  await expect(page.locator('#overall-status')).toHaveText('分析中');
  await expect(page.getByTestId('judgment-card-0')).toContainText('初步归类为融资');

  await expect(page.locator('#overall-status')).toHaveText('分析完成');
  await expect(page.getByTestId('judgment-card-0')).toContainText('初步归类为产品发布');
  await expect(page.locator('#deep-reading-context')).toContainText('某协议宣布推出支付清算新产品');
});

test('should replay gateway progress copy and credentials in the browser', async ({ page }) => {
  await page.goto('/demo/live');

  await page.getByTestId('source-drawer-toggle').click();
  await page.locator('#text-input').fill(
    [
      '某协议宣布推出支付清算新产品，并计划在下季度扩大机构服务覆盖。',
      '团队预计第三季度向机构客户开放内测，并同步推进结算层合作。',
      '[e2e-gateway]',
      '[e2e-slow]'
    ].join(' ')
  );
  await page.locator('#start-button').click();

  await expect(page.locator('#overall-status')).toHaveText('分析中');
  await expect(page.locator('#control-summary')).toContainText('批量支付与结果处理进行中');

  await expect(page.locator('#overall-status')).toHaveText('分析完成');
  await expect(page.locator('#credential-preview')).toContainText('gateway-001');
  await expect(page.locator('#credential-preview')).toContainText('0xgateway-summary');
});

test.describe('mobile overlays', () => {
  test.use({
    viewport: { width: 390, height: 844 }
  });

  test('should render detail and graph overlays in mobile full-screen mode', async ({ page }) => {
    await page.goto('/demo/live');

    await page.getByTestId('source-drawer-toggle').click();
    await page.getByTestId('preset-launch-panews-funding-round').click();

    await expect(page.locator('#overall-status')).toHaveText('分析完成');

    await page.getByTestId('judgment-card-0').click();
    await expect(page.locator('#detail-drawer')).toHaveAttribute('aria-hidden', 'false');

    const viewport = page.viewportSize();
    const detailPanelBox = await page.locator('#detail-panel').boundingBox();
    expect(viewport).not.toBeNull();
    expect(detailPanelBox).not.toBeNull();
    expect(detailPanelBox!.x).toBeLessThanOrEqual(1);
    expect(detailPanelBox!.width).toBeGreaterThanOrEqual((viewport?.width ?? 390) - 2);

    await page.locator('#detail-panel-close').click();
    await page.getByTestId('graph-expand-button').click();
    await expect(page.locator('#graph-modal')).toHaveAttribute('aria-hidden', 'false');

    const graphPanelBox = await page.locator('.graph-modal-panel').boundingBox();
    expect(graphPanelBox).not.toBeNull();
    expect(graphPanelBox!.x).toBeLessThanOrEqual(1);
    expect(graphPanelBox!.width).toBeGreaterThanOrEqual((viewport?.width ?? 390) - 2);
  });
});
