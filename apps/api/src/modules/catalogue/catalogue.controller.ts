import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  brandSchema,
  categorySchema,
  createProductSchema,
  updateProductSchema,
  updateVariantSchema,
  variantInputSchema,
  type BrandInput,
  type CategoryInput,
  type CreateProductInput,
  type UpdateProductInput,
  type UpdateVariantInput,
  type VariantInput,
} from '@stockkeep/types';
import type { Request } from 'express';
import { RequireModule, RequirePermission } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import type { RequestUser } from '../../common/request-user';
import { ZodValidationPipe } from '../../common/zod-pipe';
import { CatalogueService } from './catalogue.service';

@Controller()
@RequireModule('catalogue')
export class CatalogueController {
  constructor(private readonly catalogue: CatalogueService) {}

  @Get('categories')
  @RequirePermission('catalogue.view')
  categories() {
    return this.catalogue.listCategories();
  }

  @Post('categories')
  @RequirePermission('catalogue.manage')
  createCategory(
    @Body(new ZodValidationPipe(categorySchema)) body: CategoryInput,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.catalogue.createCategory(req.user, body, requestMeta(req));
  }

  @Patch('categories/:id')
  @RequirePermission('catalogue.manage')
  updateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(categorySchema)) body: CategoryInput,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.catalogue.updateCategory(req.user, id, body, requestMeta(req));
  }

  @Delete('categories/:id')
  @RequirePermission('catalogue.manage')
  deleteCategory(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request & { user: RequestUser }) {
    return this.catalogue.deleteCategory(req.user, id, requestMeta(req));
  }

  @Get('brands')
  @RequirePermission('catalogue.view')
  brands() {
    return this.catalogue.listBrands();
  }

  @Post('brands')
  @RequirePermission('catalogue.manage')
  createBrand(
    @Body(new ZodValidationPipe(brandSchema)) body: BrandInput,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.catalogue.createBrand(req.user, body, requestMeta(req));
  }

  @Patch('brands/:id')
  @RequirePermission('catalogue.manage')
  updateBrand(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(brandSchema)) body: BrandInput,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.catalogue.updateBrand(req.user, id, body, requestMeta(req));
  }

  @Delete('brands/:id')
  @RequirePermission('catalogue.manage')
  deleteBrand(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request & { user: RequestUser }) {
    return this.catalogue.deleteBrand(req.user, id, requestMeta(req));
  }

  @Get('units')
  @RequirePermission('catalogue.view')
  units() {
    return this.catalogue.listUnits();
  }

  @Get('products')
  @RequirePermission('catalogue.view')
  products(@Query('q') q?: string, @Query('includeInactive') includeInactive?: string) {
    return this.catalogue.listProducts(q, includeInactive === 'true');
  }

  @Get('products/:id')
  @RequirePermission('catalogue.view')
  product(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalogue.getProduct(id);
  }

  @Post('products')
  @RequirePermission('catalogue.manage')
  createProduct(
    @Body(new ZodValidationPipe(createProductSchema)) body: CreateProductInput,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.catalogue.createProduct(req.user, body, requestMeta(req));
  }

  @Patch('products/:id')
  @RequirePermission('catalogue.manage')
  updateProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateProductSchema)) body: UpdateProductInput,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.catalogue.updateProduct(req.user, id, body, requestMeta(req));
  }

  @Post('products/:id/variants')
  @RequirePermission('catalogue.manage')
  addVariant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(variantInputSchema)) body: VariantInput,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.catalogue.addVariant(req.user, id, body, requestMeta(req));
  }

  @Patch('variants/:id')
  @RequirePermission('catalogue.manage')
  updateVariant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateVariantSchema)) body: UpdateVariantInput,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.catalogue.updateVariant(req.user, id, body, requestMeta(req));
  }
}
