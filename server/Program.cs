using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.AspNetCore.Http;
using System.Threading.Tasks;
using System.Text.Json;
using System.Collections.Generic;

namespace MeshokParser
{
    public class Program
    {
        public static void Main(string[] args)
        {
            CreateHostBuilder(args).Build().Run();
        }

        public static IHostBuilder CreateHostBuilder(string[] args) =>
            Host.CreateDefaultBuilder(args)
                .ConfigureWebHostDefaults(webBuilder =>
                {
                    webBuilder.UseStartup<Startup>();
                });
    }

    public class Startup
    {
        public void ConfigureServices(IServiceCollection services)
        {
            services.AddControllers();
            services.AddSingleton<BrowserProxy>();
            services.AddHttpClient();
            services.AddCors(options =>
            {
                options.AddPolicy("AllowAll", builder =>
                {
                    builder.AllowAnyOrigin()
                           .AllowAnyMethod()
                           .AllowAnyHeader();
                });
            });
        }

        public void Configure(IApplicationBuilder app, IWebHostEnvironment env)
        {
            if (env.IsDevelopment())
            {
                app.UseDeveloperExceptionPage();
            }

            app.UseRouting();
            app.UseCors("AllowAll");

            app.UseEndpoints(endpoints =>
            {
                endpoints.MapControllers();
                
                // Основной endpoint для парсинга
                endpoints.MapGet("/parse", async (HttpContext context, BrowserProxy proxy) =>
                {
                    var categoryId = context.Request.Query["category"].ToString() ?? "252";
                    var finished = context.Request.Query["finished"].ToString() != "false";
                    
                    var url = $"https://meshok.net/good/{categoryId}{(finished ? "?opt=2" : "")}";
                    
                    var result = await proxy.ProcessRequest(url);
                    
                    context.Response.ContentType = "application/json";
                    await context.Response.WriteAsync(result);
                });

                // Endpoint для получения данных конкретного лота
                endpoints.MapGet("/item/{id}", async (string id, HttpContext context, BrowserProxy proxy) =>
                {
                    var url = $"https://meshok.net/item/{id}";
                    
                    var result = await proxy.ProcessRequest(url);
                    
                    context.Response.ContentType = "application/json";
                    await context.Response.WriteAsync(result);
                });

                // Endpoint для поиска
                endpoints.MapGet("/search", async (HttpContext context, BrowserProxy proxy) =>
                {
                    var query = context.Request.Query["q"].ToString();
                    var category = context.Request.Query["category"].ToString() ?? "252";
                    var finished = context.Request.Query["finished"].ToString() != "false";
                    
                    var url = $"https://meshok.net/?good={category}&opt={(finished ? "2" : "1")}&search={Uri.EscapeDataString(query)}";
                    
                    var result = await proxy.ProcessRequest(url);
                    
                    context.Response.ContentType = "application/json";
                    await context.Response.WriteAsync(result);
                });

                // Health check
                endpoints.MapGet("/health", async (HttpContext context) =>
                {
                    var health = new
                    {
                        status = "healthy",
                        timestamp = System.DateTime.UtcNow,
                        version = "1.0.0"
                    };
                    
                    context.Response.ContentType = "application/json";
                    await context.Response.WriteAsync(JsonSerializer.Serialize(health));
                });
            });
        }
    }
}
