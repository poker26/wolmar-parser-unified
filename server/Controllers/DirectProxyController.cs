using Microsoft.AspNetCore.Mvc;
using System.Net.Http;
using System.Threading.Tasks;
using System.Text.Json;
using System.Text;

namespace MeshokParser.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class DirectProxyController : ControllerBase
    {
        private readonly HttpClient _httpClient;
        private readonly string _chromeDebugUrl = "http://localhost:9222";

        public DirectProxyController(HttpClient httpClient)
        {
            _httpClient = httpClient;
        }

        [HttpGet("fetch")]
        public async Task<IActionResult> FetchUrl([FromQuery] string url)
        {
            if (string.IsNullOrEmpty(url))
            {
                return BadRequest("URL parameter is required");
            }

            try
            {
                // Получаем список существующих вкладок
                var tabsResponse = await _httpClient.GetAsync($"{_chromeDebugUrl}/json");
                var tabsJson = await tabsResponse.Content.ReadAsStringAsync();
                var tabs = JsonSerializer.Deserialize<JsonElement[]>(tabsJson);

                if (tabs == null || tabs.Length == 0)
                {
                    return StatusCode(500, "No Chrome tabs available");
                }

                // Используем первую вкладку
                var tab = tabs[0];
                var tabId = tab.GetProperty("id").GetString();
                var webSocketUrl = tab.GetProperty("webSocketDebuggerUrl").GetString();

                // Навигируем к URL через WebSocket URL (но используем HTTP)
                var navigateUrl = $"{_chromeDebugUrl}/json/runtime/evaluate";
                var navigateCommand = new
                {
                    id = 1,
                    method = "Page.navigate",
                    @params = new
                    {
                        url = url
                    }
                };

                var json = JsonSerializer.Serialize(navigateCommand);
                var content = new StringContent(json, Encoding.UTF8, "application/json");

                // Попробуем отправить команду навигации
                var response = await _httpClient.PostAsync(navigateUrl, content);
                
                // Ждем загрузки
                await Task.Delay(5000);

                // Получаем HTML содержимое страницы напрямую
                var htmlResponse = await _httpClient.GetAsync(url);
                
                if (!htmlResponse.IsSuccessStatusCode)
                {
                    return StatusCode(500, $"Failed to fetch URL: {htmlResponse.StatusCode}");
                }

                var htmlContent = await htmlResponse.Content.ReadAsStringAsync();

                // Проверяем на Cloudflare
                if (htmlContent.Contains("Just a moment") || htmlContent.Contains("Один момент") || htmlContent.Contains("Cloudflare"))
                {
                    return Ok(new
                    {
                        success = false,
                        message = "Cloudflare challenge detected",
                        html = htmlContent.Substring(0, Math.Min(1000, htmlContent.Length)),
                        timestamp = System.DateTime.UtcNow
                    });
                }

                return Ok(new
                {
                    success = true,
                    url = url,
                    html = htmlContent,
                    timestamp = System.DateTime.UtcNow,
                    method = "direct_http"
                });
            }
            catch (System.Exception ex)
            {
                return StatusCode(500, new
                {
                    success = false,
                    error = ex.Message
                });
            }
        }
    }
}
